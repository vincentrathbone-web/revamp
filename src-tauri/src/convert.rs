//! Plays files the web view can't (AVI, WMV, FLV, MPEG, WMA...): the bundled FFmpeg (LGPL build) turns them
//! into fragmented MP4, which the page reads in chunks and feeds to its <video>/<audio> element through Media
//! Source Extensions. A seek outside what is buffered starts a new FFmpeg at that time.
//!
//! FFmpeg is looked up in `$REVAMP_FFMPEG_DIR`, then in the app's `ffmpeg` resource folder (filled by
//! `npm run ffmpeg`).

use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Child, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Manager;

/// Bytes handed to the page per read.
const CHUNK: usize = 256 * 1024;

#[derive(Default)]
pub struct Converters {
    next: AtomicU32,
    open: Mutex<HashMap<u32, Arc<Conv>>>,
}

struct Conv {
    child: Mutex<Child>,
    out: Mutex<ChildStdout>,
    err: Arc<Mutex<String>>,
}

impl Converters {
    /// Stops every running FFmpeg (app exit).
    pub fn close_all(&self) {
        let all: Vec<_> = self.open.lock().unwrap().drain().map(|(_, c)| c).collect();
        for c in all {
            c.stop();
        }
    }
}

impl Conv {
    fn stop(&self) {
        let mut child = self.child.lock().unwrap();
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    id: u32,
    /// Where the output's timeline starts, in seconds into the file (the key frame before `start` when the
    /// picture is copied, otherwise `start` itself).
    start: f64,
}

fn tool(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    let file = format!("{name}{}", std::env::consts::EXE_SUFFIX);
    if let Ok(dir) = std::env::var("REVAMP_FFMPEG_DIR") {
        let p = PathBuf::from(dir).join(&file);
        if p.is_file() {
            return Ok(p);
        }
    }
    let p = app.path().resource_dir().map_err(|e| e.to_string())?.join("ffmpeg").join(&file);
    if p.is_file() {
        Ok(p)
    } else {
        Err(format!("{file} is missing (looked in {})", p.display()))
    }
}

/// No console window flashing up for each FFmpeg run.
fn quiet(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.stdin(Stdio::null())
}

fn secs(t: f64) -> String {
    format!("{t:.3}")
}

/// FFmpeg arguments that turn `path` (from `start` seconds) into fragmented MP4 on stdout: H.264 picture (copied
/// when it already is H.264 the player can show, else encoded by Windows' Media Foundation encoder) and stereo AAC.
/// Keep in step with `convertArgs` in scripts/dev-music.ts (the dev server's copy).
pub fn convert_args(path: &str, start: f64, copy_video: bool, has_video: bool) -> Vec<String> {
    let mut a: Vec<String> = ["-hide_banner", "-nostdin", "-v", "error"].iter().map(|s| s.to_string()).collect();
    if start > 0.0 {
        a.extend(["-ss".into(), secs(start)]);
    }
    a.extend(["-i".into(), path.into()]);
    if has_video {
        a.extend(["-map".into(), "0:v:0".into()]);
        if copy_video {
            a.extend(["-c:v".into(), "copy".into()]);
        } else {
            a.extend([
                "-vf".into(),
                // de-interlace only frames marked interlaced (DVD, TV), even size for the encoder
                "yadif=deint=interlaced,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=nv12".into(),
                "-c:v".into(),
                "h264_mf".into(),
                "-b:v".into(),
                "6M".into(),
            ]);
        }
    } else {
        a.push("-vn".into());
    }
    for s in [
        "-map", "0:a:0?", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-sn", "-dn", "-f", "mp4", "-movflags",
        "empty_moov+default_base_moof", "-frag_duration", "500000", "pipe:1",
    ] {
        a.push(s.into());
    }
    a
}

/// Reads ffprobe's `pts_time=` / `start_time=` lines: the first picture packet after a seek, as seconds into
/// the file.
pub fn parse_keyframe(out: &str) -> Option<f64> {
    let mut pts = None;
    let mut start = 0.0;
    for line in out.lines() {
        if let Some(v) = line.trim().strip_prefix("pts_time=") {
            pts = pts.or(v.parse::<f64>().ok());
        } else if let Some(v) = line.trim().strip_prefix("start_time=") {
            start = v.parse::<f64>().unwrap_or(0.0);
        }
    }
    pts.map(|p| (p - start).max(0.0))
}

/// The key frame FFmpeg will start from when copying the picture from `start`.
fn keyframe_before(ffprobe: &PathBuf, path: &str, start: f64) -> Option<f64> {
    let out = quiet(Command::new(ffprobe).args([
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-read_intervals",
        &format!("{}%+#1", secs(start)),
        "-show_entries",
        "packet=pts_time:format=start_time",
        "-of",
        "default=nw=1",
    ]))
    .arg(path)
    .output()
    .ok()?;
    parse_keyframe(&String::from_utf8_lossy(&out.stdout)).filter(|k| *k <= start + 0.001)
}

/// ffprobe's JSON description of a file (streams and container), for the page to decide how to play it.
#[tauri::command]
pub async fn media_probe(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let ffprobe = tool(&app, "ffprobe")?;
    tauri::async_runtime::spawn_blocking(move || {
        let out = quiet(Command::new(ffprobe).args([
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
        ]))
        .arg(&path)
        .output()
        .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Starts converting `path` from `start` seconds; read the output with `convert_read`.
#[tauri::command]
pub async fn convert_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, Converters>,
    path: String,
    start: f64,
    copy_video: bool,
    has_video: bool,
) -> Result<Opened, String> {
    let ffmpeg = tool(&app, "ffmpeg")?;
    let ffprobe = tool(&app, "ffprobe")?;
    let (conv, start) = tauri::async_runtime::spawn_blocking(move || {
        let start = start.max(0.0);
        let begins = if copy_video && has_video && start > 0.0 {
            keyframe_before(&ffprobe, &path, start).unwrap_or(start)
        } else {
            start
        };
        let mut child = quiet(&mut Command::new(ffmpeg))
            .args(convert_args(&path, start, copy_video, has_video))
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("cannot start ffmpeg: {e}"))?;
        let out = child.stdout.take().ok_or("no ffmpeg output")?;
        let err = Arc::new(Mutex::new(String::new()));
        if let Some(mut stderr) = child.stderr.take() {
            let err = err.clone();
            std::thread::spawn(move || {
                let mut buf = [0u8; 4096];
                while let Ok(n) = stderr.read(&mut buf) {
                    if n == 0 {
                        break;
                    }
                    let mut e = err.lock().unwrap();
                    e.push_str(&String::from_utf8_lossy(&buf[..n]));
                    if e.len() > 4000 {
                        let cut = e.len() - 2000;
                        let cut = (cut..e.len()).find(|i| e.is_char_boundary(*i)).unwrap_or(e.len());
                        e.drain(..cut);
                    }
                }
            });
        }
        Ok::<_, String>((Conv { child: Mutex::new(child), out: Mutex::new(out), err }, begins))
    })
    .await
    .map_err(|e| e.to_string())??;
    let id = state.next.fetch_add(1, Ordering::Relaxed) + 1;
    state.open.lock().unwrap().insert(id, Arc::new(conv));
    Ok(Opened { id, start })
}

/// The next chunk of converted bytes; an empty answer means the end.
#[tauri::command]
pub async fn convert_read(state: tauri::State<'_, Converters>, id: u32) -> Result<tauri::ipc::Response, String> {
    let conv = state.open.lock().unwrap().get(&id).cloned().ok_or("conversion is closed")?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut buf = vec![0u8; CHUNK];
        let n = conv.out.lock().unwrap().read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            let status = conv.child.lock().unwrap().wait().map_err(|e| e.to_string())?;
            if !status.success() {
                let e = conv.err.lock().unwrap().trim().to_string();
                return Err(if e.is_empty() { format!("ffmpeg stopped ({status})") } else { e });
            }
        }
        buf.truncate(n);
        Ok(tauri::ipc::Response::new(buf))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stops a conversion (seek, next track, or done).
#[tauri::command]
pub async fn convert_close(state: tauri::State<'_, Converters>, id: u32) -> Result<(), String> {
    let conv = state.open.lock().unwrap().remove(&id);
    if let Some(c) = conv {
        tauri::async_runtime::spawn_blocking(move || c.stop()).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn has(a: &[String], pair: [&str; 2]) -> bool {
        a.windows(2).any(|w| w[0] == pair[0] && w[1] == pair[1])
    }

    #[test]
    fn copies_or_encodes_the_picture() {
        let copy = convert_args("D:\\Films\\a.flv", 0.0, true, true);
        assert!(has(&copy, ["-c:v", "copy"]));
        assert!(!copy.contains(&"-ss".to_string()));
        assert!(has(&copy, ["-i", "D:\\Films\\a.flv"]));
        let enc = convert_args("a.avi", 12.5, false, true);
        assert!(has(&enc, ["-c:v", "h264_mf"]));
        assert!(has(&enc, ["-ss", "12.500"]));
        // -ss before -i: a fast seek in the input
        let ss = enc.iter().position(|s| s == "-ss").unwrap();
        let i = enc.iter().position(|s| s == "-i").unwrap();
        assert!(ss < i);
        assert_eq!(enc.last().unwrap(), "pipe:1");
        assert!(has(&enc, ["-movflags", "empty_moov+default_base_moof"]));
    }

    #[test]
    fn sound_only_files() {
        let a = convert_args("song.wma", 0.0, false, false);
        assert!(a.contains(&"-vn".to_string()));
        assert!(!a.iter().any(|s| s == "h264_mf" || s == "0:v:0"));
        assert!(has(&a, ["-c:a", "aac"]));
    }

    #[test]
    fn keyframe_lines() {
        assert_eq!(parse_keyframe("pts_time=4.000000\nstart_time=0.000000\n"), Some(4.0));
        assert_eq!(parse_keyframe("start_time=1.400000\npts_time=11.400000\npts_time=11.44\n"), Some(10.0));
        assert_eq!(parse_keyframe("start_time=0.0\n"), None);
        assert_eq!(parse_keyframe("pts_time=N/A\n"), None);
    }
}

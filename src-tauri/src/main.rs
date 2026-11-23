// RevAmp desktop shell. The player itself is the web app in ../src; this file only adds what a browser can't do.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

mod convert;
mod shell;

/// Files from the command line and from later starts (Explorer's Play/Enqueue), waiting for the page.
#[derive(Default)]
struct Launches(Mutex<Vec<shell::Launch>>);

const EXTENSIONS: &[&str] = &[
    "mp3", "mp2", "mp1", "flac", "ogg", "oga", "opus", "m4a", "mp4", "aac", "wav", "webm", "aif", "aiff", "m4v",
    "mkv", "mov", "ogv",
    // played through the bundled FFmpeg (src/convert.rs)
    "avi", "wmv", "asf", "flv", "f4v", "mpg", "mpeg", "m1v", "m2v", "vob", "ts", "m2ts", "mts", "3gp", "3g2", "divx",
    "rm", "rmvb", "ogm", "dv", "wtv", "wma", "ac3", "ape", "mka", "wv", "amr", "m3u", "m3u8", "pls", "xspf", "b4s",
];

fn wanted(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>, depth: u32) {
    if depth > 32 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut items: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
    items.sort_by_key(|p| p.to_string_lossy().to_lowercase());
    for p in items {
        if p.is_dir() {
            walk(&p, out, depth + 1);
        } else if wanted(&p) {
            out.push(p);
        }
    }
}

/// Files and folders (searched recursively) -> the supported files inside them, in name order.
#[tauri::command]
fn expand_paths(paths: Vec<String>) -> Vec<String> {
    let mut out = Vec::new();
    for p in paths {
        let path = PathBuf::from(&p);
        if path.is_dir() {
            walk(&path, &mut out, 0);
        } else if path.is_file() {
            out.push(path);
        }
    }
    out.into_iter().map(|p| p.to_string_lossy().into_owned()).collect()
}

/// Saves a file the user picked in the save dialog (playlists, EQ presets).
#[tauri::command]
fn write_file(path: String, data: Vec<u8>) -> Result<(), String> {
    fs::write(&path, data).map_err(|e| e.to_string())
}

/// Keeps the last crash report next to the settings, so it can be attached to a bug report.
#[tauri::command]
fn crash_report(app: tauri::AppHandle, text: String) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(dir.join("last-crash.txt"), text).map_err(|e| e.to_string())
}

/// Debug builds only: REVAMP_SELFTEST=<music file> and REVAMP_SELFTEST_OUT=<report.json> make the app play
/// the file and write a short report, so the desktop build can be checked without clicking.
#[tauri::command]
fn self_test() -> Option<(String, String)> {
    if !cfg!(debug_assertions) {
        return None;
    }
    Some((std::env::var("REVAMP_SELFTEST").ok()?, std::env::var("REVAMP_SELFTEST_OUT").ok()?))
}

/// The files waiting to be played or enqueued (the page asks after a "launch" event and once at start).
#[tauri::command]
fn take_launches(state: tauri::State<'_, Launches>) -> Vec<shell::Launch> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

/// Writes the Explorer entries for these options (skipped when they are already in place, unless `force`).
/// Debug builds leave Explorer alone unless REVAMP_SHELL=1, so a test build never takes over the menus.
#[tauri::command]
fn shell_register(options: shell::ShellOptions, force: bool) -> Result<bool, String> {
    if cfg!(debug_assertions) && std::env::var("REVAMP_SHELL").as_deref() != Ok("1") {
        return Err("This is a test build: it doesn't change Explorer (set REVAMP_SHELL=1 to allow).".into());
    }
    #[cfg(windows)]
    {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let changed = shell::registry::register("Software", &exe.to_string_lossy(), &options, force)
            .map_err(|e| e.to_string())?;
        if changed {
            shell::registry::notify_explorer();
        }
        Ok(changed)
    }
    #[cfg(not(windows))]
    Err("Only on Windows".into())
}

/// Opens Windows' Default apps page for RevAmp, where the user can make it the default player.
/// The link goes to Windows' own handler (ShellExecute), like Start > Run: explorer.exe can't open
/// an ms-settings: link with a query and shows a folder window instead.
#[tauri::command]
fn open_default_apps() -> Result<(), String> {
    #[cfg(windows)]
    {
        #[link(name = "shell32")]
        extern "system" {
            fn ShellExecuteW(
                hwnd: *mut core::ffi::c_void,
                op: *const u16,
                file: *const u16,
                params: *const u16,
                dir: *const u16,
                show: i32,
            ) -> isize;
        }
        let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
        let op = wide("open");
        let link = wide(shell::DEFAULT_APPS_LINK);
        const SW_SHOWNORMAL: i32 = 1;
        // returns a value above 32 on success
        let r = unsafe {
            ShellExecuteW(
                core::ptr::null_mut(),
                op.as_ptr(),
                link.as_ptr(),
                core::ptr::null(),
                core::ptr::null(),
                SW_SHOWNORMAL,
            )
        };
        if r > 32 { Ok(()) } else { Err(format!("Windows could not open Default apps (error {r})")) }
    }
    #[cfg(not(windows))]
    Err("Only on Windows".into())
}

/// `revamp.exe --register` / `--unregister` (run by the installer and uninstaller): writes or removes the
/// Explorer entries and exits. --register keeps the user's earlier choices and only updates the program path.
#[cfg(windows)]
fn shell_cli(args: &[String]) -> i32 {
    let result = if args.iter().any(|a| a == "--unregister") {
        shell::registry::unregister("Software")
    } else {
        let options = shell::registry::current_stamp("Software")
            .and_then(|s| shell::options_of_stamp(&s))
            .unwrap_or_default();
        std::env::current_exe()
            .and_then(|exe| shell::registry::register("Software", &exe.to_string_lossy(), &options, true).map(|_| ()))
    };
    shell::registry::notify_explorer();
    if result.is_ok() { 0 } else { 1 }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    #[cfg(windows)]
    if args.iter().any(|a| a == "--register" || a == "--unregister") {
        std::process::exit(shell_cli(&args));
    }
    let cwd = std::env::current_dir().unwrap_or_default();
    let first = shell::parse_launch(&args, &cwd);

    tauri::Builder::default()
        // must be the first plugin: a second start hands its files to the running RevAmp and quits
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let launch = shell::parse_launch(argv.get(1..).unwrap_or_default(), std::path::Path::new(&cwd));
            if let Some(l) = launch {
                app.state::<Launches>().0.lock().unwrap().push(l);
                let _ = app.emit("launch", ());
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(Launches(Mutex::new(first.into_iter().collect())))
        .manage(convert::Converters::default())
        .invoke_handler(tauri::generate_handler![
            expand_paths,
            write_file,
            crash_report,
            self_test,
            take_launches,
            shell_register,
            open_default_apps,
            convert::media_probe,
            convert::convert_open,
            convert::convert_read,
            convert::convert_close
        ])
        .build(tauri::generate_context!())
        .expect("error while running RevAmp")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<convert::Converters>().close_all();
            }
        });
}

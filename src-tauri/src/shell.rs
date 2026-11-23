//! Explorer integration, for the current user only (HKCU, no admin rights):
//! - "Play in RevAmp" / "Enqueue in RevAmp" on music, video and playlist files and on folders;
//! - RevAmp in "Open with" and in Windows' Default apps (Windows only lets the user pick the default player);
//! - what a double-click does once RevAmp is the default (play or enqueue);
//! - the command line those entries run: `revamp.exe [--play | --enqueue] <path>...`.
//! Everything written here is removed again by `unregister` (the uninstaller runs `revamp.exe --unregister`).

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Play,
    Enqueue,
}

/// Files handed to RevAmp on its command line (or forwarded from a second start).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Launch {
    pub mode: Mode,
    pub paths: Vec<String>,
}

/// Reads `[--play | --enqueue] <path>...` (without the program name); relative paths are taken from `cwd`.
/// Other `--options` are ignored. None when no path was given.
pub fn parse_launch(args: &[String], cwd: &Path) -> Option<Launch> {
    let mut mode = Mode::Play;
    let mut paths = Vec::new();
    for a in args {
        match a.as_str() {
            "--play" | "/play" => mode = Mode::Play,
            "--enqueue" | "/enqueue" | "/add" => mode = Mode::Enqueue,
            s if s.starts_with("--") || s.is_empty() => {}
            s => {
                let p = Path::new(s);
                let full = if p.is_absolute() { p.to_path_buf() } else { cwd.join(p) };
                paths.push(full.to_string_lossy().into_owned());
            }
        }
    }
    (!paths.is_empty()).then_some(Launch { mode, paths })
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellOptions {
    /// Play / Enqueue on music, video and playlist files.
    pub files: bool,
    /// Play / Enqueue on folders.
    pub folders: bool,
    /// When RevAmp is the default player, a double-click enqueues instead of playing.
    pub enqueue_default: bool,
}

impl Default for ShellOptions {
    fn default() -> Self {
        ShellOptions { files: true, folders: true, enqueue_default: false }
    }
}

pub const AUDIO: &[&str] = &[
    "mp3", "mp2", "mp1", "flac", "ogg", "oga", "opus", "m4a", "aac", "wav", "aif", "aiff", "wma", "ac3", "ape", "mka",
    "wv", "amr",
];
/// (".ts" is left out on purpose: it is also the TypeScript source extension.)
pub const VIDEO: &[&str] = &[
    "mp4", "webm", "m4v", "mkv", "mov", "ogv", "avi", "wmv", "asf", "flv", "f4v", "mpg", "mpeg", "m1v", "m2v", "vob",
    "m2ts", "mts", "3gp", "3g2", "divx", "rm", "rmvb", "ogm", "wtv",
];
pub const PLAYLISTS: &[&str] = &["m3u", "m3u8", "pls", "xspf", "b4s"];

/// The name RevAmp is listed under in RegisteredApplications.
pub const REGISTERED_NAME: &str = "RevAmp";
/// Windows' Default apps page with RevAmp selected (the query names the RegisteredApplications entry).
pub const DEFAULT_APPS_LINK: &str = "ms-settings:defaultapps?registeredAppUser=RevAmp";

const PROG_AUDIO: &str = "RevAmp.Audio";
const PROG_VIDEO: &str = "RevAmp.Video";
const PROG_PLAYLIST: &str = "RevAmp.Playlist";
const VERB_PLAY: &str = "RevAmp.Play";
const VERB_ENQUEUE: &str = "RevAmp.Enqueue";
const STAMP_VERSION: u32 = 1;

fn all_extensions() -> impl Iterator<Item = (&'static str, &'static str)> {
    AUDIO
        .iter()
        .map(|e| (*e, PROG_AUDIO))
        .chain(VIDEO.iter().map(|e| (*e, PROG_VIDEO)))
        .chain(PLAYLISTS.iter().map(|e| (*e, PROG_PLAYLIST)))
}

/// One registry value: key path (below HKCU), value name ("" = default), text.
pub type Entry = (String, String, String);

fn command(exe: &str, mode: Mode) -> String {
    let flag = if mode == Mode::Play { "--play" } else { "--enqueue" };
    format!("\"{exe}\" {flag} \"%1\"")
}

/// Every value to write for `opts`. `base` is "Software" (tests use a scratch key below it).
pub fn plan(base: &str, exe: &str, opts: &ShellOptions) -> Vec<Entry> {
    let classes = format!("{base}\\Classes");
    let icon = format!("\"{exe}\",0");
    let mut out: Vec<Entry> = Vec::new();
    let mut put = |k: String, n: &str, v: String| out.push((k, n.to_string(), v));

    // the two menu entries, on files (whatever program opens them) and on folders
    let verbs = |put: &mut dyn FnMut(String, &str, String), shell: String| {
        for (verb, label, mode) in
            [(VERB_PLAY, "Play in RevAmp", Mode::Play), (VERB_ENQUEUE, "Enqueue in RevAmp", Mode::Enqueue)]
        {
            let k = format!("{shell}\\{verb}");
            put(k.clone(), "", label.into());
            put(k.clone(), "Icon", icon.clone());
            // several selected files: one start each, no 15-file limit (a running RevAmp collects them)
            put(k.clone(), "MultiSelectModel", "Player".into());
            put(format!("{k}\\command"), "", command(exe, mode));
        }
    };
    if opts.files {
        for (ext, _) in all_extensions() {
            verbs(&mut put, format!("{classes}\\SystemFileAssociations\\.{ext}\\shell"));
        }
    }
    if opts.folders {
        verbs(&mut put, format!("{classes}\\Directory\\shell"));
    }

    // file types RevAmp can open: "Open with" and Default apps
    let default_verb = if opts.enqueue_default { "enqueue" } else { "play" };
    for (prog, name) in [(PROG_AUDIO, "Music file"), (PROG_VIDEO, "Video file"), (PROG_PLAYLIST, "Playlist")] {
        let k = format!("{classes}\\{prog}");
        put(k.clone(), "", format!("{name} (RevAmp)"));
        put(format!("{k}\\DefaultIcon"), "", icon.clone());
        put(format!("{k}\\shell"), "", default_verb.into());
        put(format!("{k}\\shell\\play"), "", "&Play".into());
        put(format!("{k}\\shell\\play\\command"), "", command(exe, Mode::Play));
        put(format!("{k}\\shell\\enqueue"), "", "&Enqueue".into());
        put(format!("{k}\\shell\\enqueue\\command"), "", command(exe, Mode::Enqueue));
    }
    let app = format!("{classes}\\Applications\\revamp.exe");
    put(app.clone(), "FriendlyAppName", "RevAmp".into());
    put(format!("{app}\\DefaultIcon"), "", icon.clone());
    put(format!("{app}\\shell\\open\\command"), "", command(exe, Mode::Play));
    let caps = format!("{base}\\RevAmp\\Capabilities");
    put(caps.clone(), "ApplicationName", "RevAmp".into());
    put(caps.clone(), "ApplicationDescription", "A skinnable music and video player".into());
    put(caps.clone(), "ApplicationIcon", icon.clone());
    for (ext, prog) in all_extensions() {
        put(format!("{classes}\\.{ext}\\OpenWithProgids"), prog, String::new());
        put(format!("{app}\\SupportedTypes"), &format!(".{ext}"), String::new());
        put(format!("{caps}\\FileAssociations"), &format!(".{ext}"), prog.into());
    }
    put(format!("{base}\\RegisteredApplications"), "RevAmp", "Software\\RevAmp\\Capabilities".replace("Software", base));
    put(format!("{base}\\RevAmp"), "ShellStamp", stamp(exe, opts));
    out
}

/// What was registered last: re-registering is skipped when nothing changed.
pub fn stamp(exe: &str, o: &ShellOptions) -> String {
    format!("v{STAMP_VERSION}|{}|{}|{}|{exe}", o.files as u8, o.folders as u8, o.enqueue_default as u8)
}

/// The options of an earlier stamp (any version), so the installer can refresh the path but keep the choices.
pub fn options_of_stamp(s: &str) -> Option<ShellOptions> {
    let mut parts = s.splitn(5, '|');
    let _version = parts.next()?;
    let mut flag = || parts.next().map(|p| p == "1");
    Some(ShellOptions { files: flag()?, folders: flag()?, enqueue_default: flag()? })
}

#[cfg(windows)]
pub mod registry {
    use super::*;
    use std::io;
    use winreg::enums::{HKEY_CURRENT_USER, KEY_ALL_ACCESS};
    use winreg::RegKey;

    fn hkcu() -> RegKey {
        RegKey::predef(HKEY_CURRENT_USER)
    }

    fn missing_ok(r: io::Result<()>) -> io::Result<()> {
        match r {
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
            other => other,
        }
    }

    /// Deletes a key we created if nothing else is left in it (keys shared with other programs stay).
    fn prune(path: &str) {
        let Ok(k) = hkcu().open_subkey(path) else { return };
        if let Ok(info) = k.query_info() {
            if info.sub_keys == 0 && info.values == 0 {
                let _ = hkcu().delete_subkey(path);
            }
        }
    }

    fn delete_value(path: &str, name: &str) -> io::Result<()> {
        match hkcu().open_subkey_with_flags(path, KEY_ALL_ACCESS) {
            Ok(k) => missing_ok(k.delete_value(name)),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e),
        }
    }

    pub fn current_stamp(base: &str) -> Option<String> {
        hkcu().open_subkey(format!("{base}\\RevAmp")).ok()?.get_value("ShellStamp").ok()
    }

    /// Removes everything `plan` can write (for any options).
    pub fn unregister(base: &str) -> io::Result<()> {
        let classes = format!("{base}\\Classes");
        let h = hkcu();
        for (ext, prog) in all_extensions() {
            let shell = format!("{classes}\\SystemFileAssociations\\.{ext}\\shell");
            for verb in [VERB_PLAY, VERB_ENQUEUE] {
                missing_ok(h.delete_subkey_all(format!("{shell}\\{verb}")))?;
            }
            prune(&shell);
            prune(&format!("{classes}\\SystemFileAssociations\\.{ext}"));
            let owp = format!("{classes}\\.{ext}\\OpenWithProgids");
            delete_value(&owp, prog)?;
            prune(&owp);
            prune(&format!("{classes}\\.{ext}"));
        }
        for verb in [VERB_PLAY, VERB_ENQUEUE] {
            missing_ok(h.delete_subkey_all(format!("{classes}\\Directory\\shell\\{verb}")))?;
        }
        for prog in [PROG_AUDIO, PROG_VIDEO, PROG_PLAYLIST] {
            missing_ok(h.delete_subkey_all(format!("{classes}\\{prog}")))?;
        }
        missing_ok(h.delete_subkey_all(format!("{classes}\\Applications\\revamp.exe")))?;
        missing_ok(h.delete_subkey_all(format!("{base}\\RevAmp")))?;
        delete_value(&format!("{base}\\RegisteredApplications"), "RevAmp")?;
        Ok(())
    }

    /// Writes the entries for `opts` (after removing old ones). Returns false when they were already in place.
    pub fn register(base: &str, exe: &str, opts: &ShellOptions, force: bool) -> io::Result<bool> {
        if !force && current_stamp(base).as_deref() == Some(stamp(exe, opts).as_str()) {
            return Ok(false);
        }
        unregister(base)?;
        let h = hkcu();
        for (key, name, value) in plan(base, exe, opts) {
            let (k, _) = h.create_subkey(&key)?;
            k.set_value(&name, &value)?;
        }
        Ok(true)
    }

    /// Tells Explorer the file types changed, so menus and icons update without a restart.
    pub fn notify_explorer() {
        #[link(name = "shell32")]
        extern "system" {
            fn SHChangeNotify(event: i32, flags: u32, item1: *const core::ffi::c_void, item2: *const core::ffi::c_void);
        }
        const SHCNE_ASSOCCHANGED: i32 = 0x0800_0000;
        unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, 0, core::ptr::null(), core::ptr::null()) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn command_lines() {
        let cwd = PathBuf::from("D:\\Music");
        assert_eq!(
            parse_launch(&s(&["--enqueue", "D:\\a b\\x.mp3"]), &cwd),
            Some(Launch { mode: Mode::Enqueue, paths: s(&["D:\\a b\\x.mp3"]) })
        );
        let l = parse_launch(&s(&["song.flac", "D:\\y.ogg"]), &cwd).unwrap();
        assert_eq!(l.mode, Mode::Play);
        assert_eq!(l.paths, s(&["D:\\Music\\song.flac", "D:\\y.ogg"]));
        assert_eq!(parse_launch(&s(&["--play"]), &cwd), None);
        assert_eq!(parse_launch(&s(&["--register", "--something"]), &cwd), None);
    }

    fn find<'a>(p: &'a [Entry], key_end: &str, name: &str) -> Option<&'a str> {
        p.iter().find(|(k, n, _)| k.ends_with(key_end) && n == name).map(|(_, _, v)| v.as_str())
    }

    #[test]
    fn menu_entries_follow_the_options() {
        let exe = "C:\\Program Files\\RevAmp\\revamp.exe";
        let all = plan("Software", exe, &ShellOptions::default());
        assert_eq!(
            find(&all, "SystemFileAssociations\\.mp3\\shell\\RevAmp.Play\\command", ""),
            Some("\"C:\\Program Files\\RevAmp\\revamp.exe\" --play \"%1\"")
        );
        assert_eq!(find(&all, "SystemFileAssociations\\.avi\\shell\\RevAmp.Enqueue", ""), Some("Enqueue in RevAmp"));
        assert_eq!(find(&all, "Directory\\shell\\RevAmp.Enqueue\\command", "").map(|c| c.contains("--enqueue")), Some(true));
        assert_eq!(find(&all, "Classes\\RevAmp.Audio\\shell", ""), Some("play"));
        assert_eq!(find(&all, "Capabilities\\FileAssociations", ".mkv"), Some("RevAmp.Video"));
        assert_eq!(find(&all, "RegisteredApplications", "RevAmp"), Some("Software\\RevAmp\\Capabilities"));
        // the Default apps link must name that same entry
        assert!(DEFAULT_APPS_LINK.ends_with(&format!("registeredAppUser={REGISTERED_NAME}")));
        // TypeScript files are not touched
        assert!(!all.iter().any(|(k, n, _)| k.contains("\\.ts\\") || k.ends_with("\\.ts") || n == ".ts"));
        // every key is below the base
        assert!(all.iter().all(|(k, _, _)| k.starts_with("Software\\")));

        let none = plan("Software", exe, &ShellOptions { files: false, folders: false, enqueue_default: true });
        assert!(!none.iter().any(|(k, _, _)| k.contains("SystemFileAssociations") || k.contains("Directory")));
        assert_eq!(find(&none, "Classes\\RevAmp.Video\\shell", ""), Some("enqueue"));
    }

    #[test]
    fn stamps_round_trip() {
        let o = ShellOptions { files: true, folders: false, enqueue_default: true };
        let st = stamp("C:\\x|y\\revamp.exe", &o);
        assert_eq!(options_of_stamp(&st), Some(o));
        assert_eq!(options_of_stamp("garbage"), None);
    }

    /// Writes to a scratch key (HKCU\Software\RevAmpTest), reads back, removes it again.
    #[cfg(windows)]
    #[test]
    fn registry_round_trip() {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        let base = "Software\\RevAmpTest";
        let h = RegKey::predef(HKEY_CURRENT_USER);
        let _ = h.delete_subkey_all(base);
        let exe = "D:\\Test\\revamp.exe";
        let o = ShellOptions::default();
        assert!(registry::register(base, exe, &o, false).unwrap());
        assert!(!registry::register(base, exe, &o, false).unwrap(), "unchanged: skipped");
        let cmd: String = h
            .open_subkey(format!("{base}\\Classes\\SystemFileAssociations\\.flac\\shell\\RevAmp.Play\\command"))
            .unwrap()
            .get_value("")
            .unwrap();
        assert_eq!(cmd, "\"D:\\Test\\revamp.exe\" --play \"%1\"");
        // another program's value in a shared key survives our removal
        let (other, _) = h.create_subkey(format!("{base}\\Classes\\.flac\\OpenWithProgids")).unwrap();
        other.set_value("Other.App", &"").unwrap();
        // turning folders off removes their entries
        let fewer = ShellOptions { folders: false, ..o.clone() };
        assert!(registry::register(base, exe, &fewer, false).unwrap());
        assert!(h.open_subkey(format!("{base}\\Classes\\Directory\\shell\\RevAmp.Play")).is_err());
        registry::unregister(base).unwrap();
        assert!(h.open_subkey(format!("{base}\\Classes\\RevAmp.Audio")).is_err());
        assert!(h.open_subkey(format!("{base}\\Classes\\SystemFileAssociations\\.mp3")).is_err(), "emptied keys pruned");
        let left: String = h.open_subkey(format!("{base}\\Classes\\.flac\\OpenWithProgids")).unwrap().get_value("Other.App").unwrap();
        assert_eq!(left, "");
        h.delete_subkey_all(base).unwrap();
    }
}

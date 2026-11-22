// RevAmp desktop shell. The player itself is the web app in ../src; this file only adds what a browser can't do.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

mod convert;

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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(convert::Converters::default())
        .invoke_handler(tauri::generate_handler![
            expand_paths,
            write_file,
            crash_report,
            self_test,
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

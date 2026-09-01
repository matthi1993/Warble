//! Reveal a file in the host OS file manager
//! (Finder on macOS, Explorer on Windows, default file manager on Linux).

use std::path::Path;
#[cfg(all(
    unix,
    not(target_os = "macos"),
    not(target_os = "ios"),
    not(target_os = "android")
))]
use std::path::PathBuf;
#[cfg(desktop)]
use std::process::Command;
use tauri::State;

use crate::app_state::AppState;

#[tauri::command]
pub async fn reveal_in_file_manager(
    path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let resolved = state.resolve_library_path(&path)?;
    tauri::async_runtime::spawn_blocking(move || reveal(&resolved))
        .await
        .map_err(|e| e.to_string())?
}

fn reveal(p: &Path) -> Result<(), String> {
    if !p.exists() {
        return Err(format!("path does not exist: {}", p.display()));
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(p)
            .status()
            .map_err(|e| format!("failed to launch Finder: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        // /select, then the path; explorer is forgiving about quoting here.
        Command::new("explorer")
            .arg(format!("/select,{}", p.display()))
            .status()
            .map_err(|e| format!("failed to launch Explorer: {e}"))?;
        return Ok(());
    }

    #[cfg(all(
        unix,
        not(target_os = "macos"),
        not(target_os = "ios"),
        not(target_os = "android")
    ))]
    {
        // Try the FreeDesktop "ShowItems" DBus interface (selects the file
        // in Nautilus, Dolphin, Nemo, …). Fall back to xdg-open on the
        // parent directory if dbus-send is missing or the call fails.
        let uri = file_uri(p);
        let dbus_ok = Command::new("dbus-send")
            .args([
                "--session",
                "--print-reply",
                "--dest=org.freedesktop.FileManager1",
                "/org/freedesktop/FileManager1",
                "org.freedesktop.FileManager1.ShowItems",
                &format!("array:string:{uri}"),
                "string:",
            ])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if dbus_ok {
            return Ok(());
        }
        let parent: PathBuf = p
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| p.to_path_buf());
        Command::new("xdg-open")
            .arg(parent)
            .status()
            .map_err(|e| format!("failed to launch xdg-open: {e}"))?;
        Ok(())
    }

    #[cfg(any(target_os = "ios", target_os = "android"))]
    {
        Err("Reveal in file manager is unavailable on mobile".to_string())
    }
}

#[cfg(all(
    unix,
    not(target_os = "macos"),
    not(target_os = "ios"),
    not(target_os = "android")
))]
fn file_uri(p: &Path) -> String {
    // Minimal file:// URI; spaces and a few specials are percent-encoded.
    let s = p.to_string_lossy();
    let mut out = String::from("file://");
    for b in s.as_bytes() {
        match *b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                out.push(*b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

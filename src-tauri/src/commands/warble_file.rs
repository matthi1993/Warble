//! Tauri commands backing the "File > Save/Load Library …" menu items.
//!
//! The whole user-meaningful library state lives in a single SQLite
//! database (see [`crate::library::LibraryRepository`]) — imported
//! folders, photo edits, ratings, variants, and `app_settings` rows.
//! "Saving" the library is therefore a clean copy of that DB to a
//! user-chosen location; "loading" is the inverse, plus a restart so
//! every long-lived `Arc<LibraryRepository>` and cached snapshot
//! (settings, exif cache, etc.) is rebuilt from the new file.
//!
//! Caches under `app_cache_dir()` (thumbnails, HD images, full-image
//! memory cache) are intentionally NOT part of the library — they're
//! regenerable from the source photos.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, State};

use crate::app_state::AppState;
use crate::library::library_db_path;

/// Default file extension for saved library files. Kept distinct from
/// the canonical on-disk DB so users can recognise their backups.
const LIBRARY_FILE_EXT: &str = "warble";

/// Write a clean snapshot of the active library DB to `path`. Uses
/// SQLite's `VACUUM INTO`, which is safe to call against a live
/// connection and produces a single self-contained file (no
/// WAL/SHM sidecars). If `path` already exists it is removed first,
/// since `VACUUM INTO` refuses to overwrite.
#[tauri::command]
pub async fn save_library(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let dest = ensure_extension(PathBuf::from(&path), LIBRARY_FILE_EXT);
    if let Some(parent) = dest.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    if dest.exists() {
        std::fs::remove_file(&dest).map_err(|e| e.to_string())?;
    }
    state.repository()?.vacuum_into(&dest)?;
    Ok(())
}

/// Replace the active library with the contents of `path` and restart
/// the app. We restart rather than hot-swap because the repository
/// `Arc` is held by [`crate::imaging::exif_cache`] and the
/// [`crate::settings::SettingsStore`] snapshot — re-running the
/// normal startup sequence is the simplest way to guarantee every
/// consumer sees the new DB.
#[tauri::command]
pub async fn load_library(app: AppHandle, path: String) -> Result<(), String> {
    let source = PathBuf::from(&path);
    if !source.is_file() {
        return Err(format!("library file does not exist: {}", source.display()));
    }
    let dest = library_db_path(&app);
    if same_file(&source, &dest) {
        // Nothing to do — the user picked the file we're already using.
        return Ok(());
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // Drop any WAL/SHM sidecars left over from the previous session so
    // the freshly-copied DB isn't mixed with stale journal data.
    remove_sqlite_sidecars(&dest);
    std::fs::copy(&source, &dest).map_err(|e| e.to_string())?;
    // `restart` does not return.
    app.restart();
}

/// If `path` has no extension, append `ext`. Leaves an existing
/// extension alone — users may deliberately pick a non-default suffix.
fn ensure_extension(mut path: PathBuf, ext: &str) -> PathBuf {
    if path.extension().is_none() {
        path.set_extension(ext);
    }
    path
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

fn remove_sqlite_sidecars(db_path: &Path) {
    for suffix in ["-wal", "-shm", "-journal"] {
        let mut p = db_path.as_os_str().to_owned();
        p.push(suffix);
        let _ = std::fs::remove_file(PathBuf::from(p));
    }
}

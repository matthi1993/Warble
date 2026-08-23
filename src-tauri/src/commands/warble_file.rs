//! Tauri commands backing the "File > Save/Load Library …" menu items.
//!
//! The whole user-meaningful library state lives in a single SQLite
//! database — imported folders, photo edits, ratings, variants, and
//! `app_settings` rows. "Saving" copies that DB to a user-chosen
//! location; "Loading" hot-swaps the active repository to a new DB
//! file and emits an event so the frontend reloads all state.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Emitter, Manager, State};

use crate::app_state::AppState;
use crate::imaging::exif_cache;
use crate::library::{library_db_path, LibraryRepository};

const LIBRARY_FILE_EXT: &str = "warble";
const LAST_LIBRARY_KEY: &str = "last_library_path";

/// Write a clean snapshot of the active library DB to `path`.
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

/// Hot-swap the active library with the contents of `path`.
///
/// 1. Copy the source file to a temporary path next to the active DB.
/// 2. Drop the old `LibraryRepository` Arc (closing its SQLite
///    connection).
/// 3. Replace the active DB file with the temp copy.
/// 4. Open a fresh `LibraryRepository` and install it in `AppState`.
/// 5. Re-init the exif cache and settings from the new repo.
/// 6. Re-hydrate the in-memory catalog from the new DB's imported roots.
/// 7. Emit `library-reloaded` so the frontend re-fetches everything.
///
/// No restart — the app stays alive the entire time.
#[tauri::command]
pub async fn load_library(app: AppHandle, path: String) -> Result<(), String> {
    let source = PathBuf::from(&path);
    if !source.is_file() {
        return Err(format!("library file does not exist: {}", source.display()));
    }
    let dest = library_db_path(&app);
    if same_file(&source, &dest) {
        return Ok(());
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    // 1. Copy source to a temp file next to the destination.
    let tmp = dest.with_extension("warble.tmp");
    std::fs::copy(&source, &tmp).map_err(|e| format!("failed to copy library file: {e}"))?;

    // 2. Drop the old repository so its SQLite connection closes
    //    before we overwrite the file.
    {
        let state = app.state::<AppState>();
        let repo_arc = state.repository.lock().ok().and_then(|mut g| g.take());
        drop(repo_arc); // explicitly drop to close the connection
    }

    // 3. Replace the active DB file.
    remove_sqlite_sidecars(&dest);
    // rename may fail if tmp and dest are on different volumes;
    // fall back to copy + remove.
    if std::fs::rename(&tmp, &dest).is_err() {
        std::fs::copy(&tmp, &dest).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(&tmp);
    }

    // 4. Open the new repository.
    let new_repo = LibraryRepository::open(&dest)?;

    // 5-7. Install new repo, re-init caches, re-hydrate catalog.
    let arc = std::sync::Arc::new(new_repo);
    exif_cache::init(std::sync::Arc::clone(&arc));

    {
        let state = app.state::<AppState>();
        state.settings.load_from(arc.as_ref());

        let _ = arc.set_setting(LAST_LIBRARY_KEY, &source.to_string_lossy());

        // Re-hydrate the in-memory catalog from the new DB's roots.
        if let Ok(mut catalog) = state.catalog.lock() {
            catalog.reset();
            if let Ok(root_paths) = arc.imported_root_paths() {
                for root_path in root_paths {
                    let _ = catalog.rehydrate_root(&PathBuf::from(root_path));
                }
            }
        }

        state.swap_repository(arc);
    }

    // 8. Notify the frontend so it reloads photos, edits, ratings,
    //    variants, and view state from the new DB.
    let _ = app.emit("library-reloaded", ());

    Ok(())
}

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

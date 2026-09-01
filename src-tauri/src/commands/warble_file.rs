//! Tauri commands backing the "File > Save/Load Library …" menu items.
//!
//! The whole user-meaningful library state lives in a single SQLite
//! database — imported folders, photo edits, ratings, variants, and
//! `app_settings` rows. "Saving" copies that DB to a user-chosen
//! location; "Loading" hot-swaps the active repository to a new DB
//! file and emits an event so the frontend reloads all state.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
#[cfg(not(any(target_os = "ios", target_os = "android")))]
use tauri_plugin_dialog::DialogExt;

use crate::app_state::AppState;
use crate::imaging::exif_cache;
use crate::library::{library_db_path, LibraryRepository};

const LIBRARY_FILE_EXT: &str = "warble";

#[derive(Serialize)]
pub struct LibrarySelection {
    path: String,
    bookmark: Option<String>,
}

#[tauri::command]
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub async fn select_library_dialog(app: AppHandle) -> Option<LibrarySelection> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("Warble Library", &[LIBRARY_FILE_EXT])
            .blocking_pick_file()
            .map(|path| LibrarySelection {
                path: path.to_string(),
                bookmark: None,
            })
    })
    .await
    .unwrap_or(None)
}

#[tauri::command]
#[cfg(target_os = "ios")]
pub async fn select_library_dialog(app: AppHandle) -> Result<Option<LibrarySelection>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        tauri_plugin_folder_access::pick_library(&app).map(|selection| {
            selection.map(|grant| LibrarySelection {
                path: grant.path,
                bookmark: Some(grant.bookmark),
            })
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
#[cfg(target_os = "android")]
pub async fn select_library_dialog(_app: AppHandle) -> Result<Option<LibrarySelection>, String> {
    Err("Opening libraries is not implemented on Android".to_string())
}

/// Return the user-facing path of the currently open library.
///
/// Loaded libraries are copied into the app's canonical working database, so
/// prefer the recorded source path. A fresh library has no source path yet and
/// is represented by the canonical database path instead.
#[tauri::command]
pub fn get_open_library_path(app: AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    if let Some(path) = state.device_storage.last_library_path() {
        return Ok(path.to_string_lossy().into_owned());
    }

    Ok(library_db_path(&app).to_string_lossy().into_owned())
}

/// Write a clean snapshot of the active library DB to `path`.
#[tauri::command]
pub async fn save_library(
    app: AppHandle,
    path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let dest = ensure_extension(PathBuf::from(&path), LIBRARY_FILE_EXT);
    write_snapshot(&app, &state, &dest)?;
    state.device_storage.set_last_library_path(Some(&dest))?;
    Ok(())
}

#[tauri::command]
pub async fn save_open_library(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let dest = state
        .device_storage
        .last_library_path()
        .ok_or_else(|| "Choose a library location first".to_string())?;
    write_snapshot(&app, &state, &dest)
}

#[cfg(not(target_os = "ios"))]
fn write_snapshot(_app: &AppHandle, state: &AppState, dest: &Path) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    let tmp = dest.with_extension("warble.tmp");
    if tmp.exists() {
        std::fs::remove_file(&tmp).map_err(|e| e.to_string())?;
    }
    state.repository()?.vacuum_into(&tmp)?;
    atomic_replace(&tmp, &dest)?;
    Ok(())
}

#[cfg(target_os = "ios")]
fn write_snapshot(app: &AppHandle, state: &AppState, dest: &Path) -> Result<(), String> {
    let tmp = library_db_path(app).with_extension("export.tmp");
    if tmp.exists() {
        std::fs::remove_file(&tmp).map_err(|e| e.to_string())?;
    }
    state.repository()?.vacuum_into(&tmp)?;
    let source = tmp
        .to_str()
        .ok_or_else(|| "temporary library path is not valid UTF-8".to_string())?;
    let destination = dest
        .to_str()
        .ok_or_else(|| "library path is not valid UTF-8".to_string())?;
    tauri_plugin_folder_access::replace_library(app, source, destination)
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
pub async fn load_library(
    app: AppHandle,
    path: String,
    bookmark: Option<String>,
) -> Result<(), String> {
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

    // Validate (and, if needed, migrate) the copy before touching the active
    // repository. Selecting a non-Warble document must leave the current
    // library fully usable.
    let validated = LibraryRepository::open(&tmp)
        .map_err(|e| format!("selected file is not a valid Warble library: {e}"))?;
    drop(validated);

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

        let library_id = arc.library_id()?;
        state.set_active_library_id(library_id.clone());
        for (root_id, legacy_path) in arc.legacy_root_bindings()? {
            state.device_storage.set_root_binding(
                &library_id,
                &root_id,
                Path::new(&legacy_path),
            )?;
        }
        arc.clear_legacy_root_bindings()?;
        state.device_storage.set_last_library_path(Some(&source))?;
        if let Some(bookmark) = bookmark.as_deref() {
            state.device_storage.set_library_bookmark(Some(bookmark))?;
        }

        crate::library::restore_security_scoped_roots(&app, &state, &library_id);
        crate::library::rehydrate_media_roots(arc.as_ref(), &state);

        state.swap_repository(arc);
    }

    // If migration changed the working copy, write the portable form back on
    // the next explicit save. The selected external file is never modified by
    // merely opening it.

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

#[cfg(not(target_os = "ios"))]
fn atomic_replace(tmp: &Path, dest: &Path) -> Result<(), String> {
    if !dest.exists() {
        return std::fs::rename(tmp, dest).map_err(|e| e.to_string());
    }
    let backup = dest.with_extension("warble.backup");
    if backup.exists() {
        std::fs::remove_file(&backup).map_err(|e| e.to_string())?;
    }
    std::fs::rename(dest, &backup).map_err(|e| e.to_string())?;
    match std::fs::rename(tmp, dest) {
        Ok(()) => {
            let _ = std::fs::remove_file(backup);
            Ok(())
        }
        Err(error) => {
            let _ = std::fs::rename(&backup, dest);
            Err(format!("failed to replace library snapshot: {error}"))
        }
    }
}

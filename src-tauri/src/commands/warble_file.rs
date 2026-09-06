//! Tauri commands backing the "File > Save/Load Library …" menu items.
//!
//! The whole user-meaningful library state lives in a single SQLite
//! database — imported folders, photo edits, ratings, variants, and
//! `app_settings` rows. "Saving" copies that DB to a user-chosen
//! location; "Loading" hot-swaps the active repository to a new DB
//! file and emits an event so the frontend reloads all state.

use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
#[cfg(not(any(target_os = "ios", target_os = "android")))]
use tauri_plugin_dialog::DialogExt;

use crate::app_state::AppState;
use crate::device_storage::FileFingerprint;
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

/// Replace the active working database with a fresh empty library. The new
/// library is intentionally untitled until the user saves it somewhere.
#[tauri::command]
pub async fn create_new_library(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let dest = library_db_path(&app);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let tmp = dest.with_extension("warble.new");
    remove_sqlite_sidecars(&tmp);
    if tmp.exists() {
        std::fs::remove_file(&tmp).map_err(|e| e.to_string())?;
    }

    // Create and validate the complete schema before touching the active DB.
    let fresh = LibraryRepository::open(&tmp)?;
    drop(fresh);

    {
        let old = state.repository.lock().ok().and_then(|mut guard| guard.take());
        drop(old);
    }

    remove_sqlite_sidecars(&dest);
    if std::fs::rename(&tmp, &dest).is_err() {
        std::fs::copy(&tmp, &dest).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(&tmp);
    }

    let repo = LibraryRepository::open(&dest)?;
    let library_id = repo.library_id()?;
    let arc = std::sync::Arc::new(repo);
    exif_cache::init(std::sync::Arc::clone(&arc));
    state.set_active_library_id(library_id);
    state
        .device_storage
        .set_library_source(None, None, None)?;
    crate::library::rehydrate_media_roots(arc.as_ref(), &state);
    state.swap_repository(arc);
    let _ = app.emit("library-reloaded", ());
    Ok(())
}

/// Write a clean snapshot of the active library DB to `path`.
#[tauri::command]
pub async fn save_library(
    app: AppHandle,
    path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let dest = ensure_extension(PathBuf::from(&path), LIBRARY_FILE_EXT);
    ensure_source_unchanged_if_same_destination(&state, &dest)?;
    let renewed_bookmark = write_snapshot(&app, &state, &dest)?;
    let fingerprint = file_fingerprint(&dest)?;
    state
        .device_storage
        .set_library_source(
            Some(&dest),
            renewed_bookmark.as_deref(),
            Some(fingerprint),
        )?;
    Ok(())
}

/// Present the platform's Save/Export picker and remember the selected file
/// as the active library location for subsequent saves and next launch.
#[tauri::command]
pub async fn save_library_as(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        let dialog_app = app.clone();
        let selected = tauri::async_runtime::spawn_blocking(move || {
            dialog_app
                .dialog()
                .file()
                .set_file_name("library.warble")
                .add_filter("Warble Library", &[LIBRARY_FILE_EXT])
                .blocking_save_file()
                .map(|path| path.to_string())
        })
        .await
        .map_err(|e| e.to_string())?;
        let Some(path) = selected else {
            return Ok(None);
        };
        let dest = ensure_extension(PathBuf::from(path), LIBRARY_FILE_EXT);
        ensure_source_unchanged_if_same_destination(&state, &dest)?;
        write_snapshot(&app, &state, &dest)?;
        let fingerprint = file_fingerprint(&dest)?;
        state
            .device_storage
            .set_library_source(Some(&dest), None, Some(fingerprint))?;
        return Ok(Some(dest.to_string_lossy().into_owned()));
    }

    #[cfg(target_os = "ios")]
    {
        // iOS saves documents by exporting an existing file through the Files
        // picker. Build a clean SQLite snapshot first, then retain the returned
        // security-scoped bookmark so it can be reopened at launch.
        let mut temp = library_db_path(&app);
        temp.set_file_name("Warble Library.warble");
        if temp.exists() {
            std::fs::remove_file(&temp).map_err(|e| e.to_string())?;
        }
        state.repository()?.vacuum_into(&temp)?;
        let source = temp
            .to_str()
            .ok_or_else(|| "temporary library path is not valid UTF-8".to_string())?;
        let result = tauri_plugin_folder_access::export_library(&app, source);
        let _ = std::fs::remove_file(&temp);
        let Some(grant) = result? else {
            return Ok(None);
        };
        let dest = PathBuf::from(&grant.path);
        let fingerprint = file_fingerprint(&dest)?;
        state.device_storage.set_library_source(
            Some(&dest),
            Some(&grant.bookmark),
            Some(fingerprint),
        )?;
        return Ok(Some(grant.path));
    }

    #[cfg(target_os = "android")]
    {
        let _ = (app, state);
        Err("Saving libraries is not implemented on Android".to_string())
    }
}

#[tauri::command]
pub async fn save_open_library(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let remembered_path = state
        .device_storage
        .last_library_path()
        .ok_or_else(|| "Choose a library location first".to_string())?;
    let expected = state.device_storage.library_fingerprint().ok_or_else(|| {
        "This library was opened before safe shared saving was enabled. Reopen it or use Save As before saving to its current location."
            .to_string()
    })?;
    let (dest, bookmark) = resolve_library_source(&app, &state, &remembered_path)?;
    let current = file_fingerprint(&dest)
        .map_err(|error| format!("the shared library is unavailable: {error}"))?;
    if current != expected {
        return Err(
            "The shared library changed after you opened it. Open it again to get the newer version, or use Save As to preserve your local changes."
                .to_string(),
        );
    }

    let renewed_bookmark = write_snapshot(&app, &state, &dest)?;
    let fingerprint = file_fingerprint(&dest)?;
    state.device_storage.set_library_source(
        Some(&dest),
        renewed_bookmark.as_deref().or(bookmark.as_deref()),
        Some(fingerprint),
    )
}

#[cfg(not(target_os = "ios"))]
fn resolve_library_source(
    _app: &AppHandle,
    _state: &AppState,
    remembered_path: &Path,
) -> Result<(PathBuf, Option<String>), String> {
    Ok((remembered_path.to_path_buf(), None))
}

#[cfg(target_os = "ios")]
fn resolve_library_source(
    app: &AppHandle,
    state: &AppState,
    _remembered_path: &Path,
) -> Result<(PathBuf, Option<String>), String> {
    let bookmark = state.device_storage.library_bookmark().ok_or_else(|| {
        "The iPad no longer has permission to update this library. Open it again or use Save As."
            .to_string()
    })?;
    let grant = tauri_plugin_folder_access::resolve_bookmark(app, &bookmark)
        .map_err(|error| format!("could not reconnect to the shared library: {error}"))?;
    Ok((PathBuf::from(&grant.path), Some(grant.bookmark)))
}

#[cfg(not(target_os = "ios"))]
fn write_snapshot(
    _app: &AppHandle,
    state: &AppState,
    dest: &Path,
) -> Result<Option<String>, String> {
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
    Ok(None)
}

#[cfg(target_os = "ios")]
fn write_snapshot(
    app: &AppHandle,
    state: &AppState,
    dest: &Path,
) -> Result<Option<String>, String> {
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
        .map(|grant| Some(grant.bookmark))
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
    let source_fingerprint = file_fingerprint(&source)
        .map_err(|error| format!("failed to read library file: {error}"))?;
    if same_file(&source, &dest) {
        let state = app.state::<AppState>();
        state.device_storage.set_library_source(
            Some(&source),
            bookmark.as_deref(),
            Some(source_fingerprint),
        )?;
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
    let _ = arc.delete_setting("cache_settings");
    exif_cache::init(std::sync::Arc::clone(&arc));

    {
        let state = app.state::<AppState>();
        // Performance/cache choices belong to this device, not to the
        // library being opened.
        state.settings.load_from(&state.device_storage);

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
        state.device_storage.set_library_source(
            Some(&source),
            bookmark.as_deref(),
            Some(source_fingerprint),
        )?;

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

fn ensure_source_unchanged_if_same_destination(
    state: &AppState,
    destination: &Path,
) -> Result<(), String> {
    let Some(source) = state.device_storage.last_library_path() else {
        return Ok(());
    };
    if !same_file(&source, destination) {
        return Ok(());
    }
    let expected = state.device_storage.library_fingerprint().ok_or_else(|| {
        "Reopen this library before replacing it, or choose a different Save As location."
            .to_string()
    })?;
    let current = file_fingerprint(destination)
        .map_err(|error| format!("the existing library is unavailable: {error}"))?;
    if current == expected {
        Ok(())
    } else {
        Err(
            "The selected library changed after you opened it. Reopen it, or save your local changes under a different name."
                .to_string(),
        )
    }
}

fn remove_sqlite_sidecars(db_path: &Path) {
    for suffix in ["-wal", "-shm", "-journal"] {
        let mut p = db_path.as_os_str().to_owned();
        p.push(suffix);
        let _ = std::fs::remove_file(PathBuf::from(p));
    }
}

pub(crate) fn file_fingerprint(path: &Path) -> Result<FileFingerprint, String> {
    let mut file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    let mut first = 0xcbf29ce484222325_u64;
    let mut second = 0x84222325cbf29ce4_u64;
    let mut size = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        size += read as u64;
        for byte in &buffer[..read] {
            first ^= u64::from(*byte);
            first = first.wrapping_mul(0x100000001b3);
            second ^= u64::from(*byte);
            second = second.rotate_left(5).wrapping_mul(0x9e3779b185ebca87);
        }
    }
    Ok(FileFingerprint {
        size,
        content_hash: format!("{first:016x}{second:016x}"),
    })
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprint_changes_when_file_contents_change() {
        let path = std::env::temp_dir().join(format!(
            "warble-fingerprint-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(&path, b"first library").unwrap();
        let first = file_fingerprint(&path).unwrap();
        std::fs::write(&path, b"second library").unwrap();
        let second = file_fingerprint(&path).unwrap();
        assert_ne!(first, second);
        std::fs::remove_file(path).unwrap();
    }
}

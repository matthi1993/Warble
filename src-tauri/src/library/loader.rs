use crate::app_state;
use crate::imaging;

use app_state::AppState;
#[cfg(target_os = "ios")]
use tauri::Emitter;
use tauri::Manager;

#[cfg(desktop)]
use crate::menu;
use crate::tasks;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::library::{LibraryCatalog, LibraryRepository};
use imaging::{exif_cache, full_image, hd_image, thumbnails};

/// Canonical on-disk location of the active library database.
pub fn library_db_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .ok()
        .map(|mut p| {
            p.push("active-library.warble");
            p
        })
        .unwrap_or_else(|| PathBuf::from("./library.warble"))
}

pub fn init_library_repository(app: &tauri::App) {
    let db_path = library_db_path(app.handle());
    if let Some(parent) = db_path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            eprintln!("failed to create library dir at {parent:?}: {e}");
        }
    }

    let state = app.state::<AppState>();
    if let Ok(mut path) = app.path().app_data_dir() {
        path.push("device-state.json");
        if let Err(e) = state.device_storage.init(path) {
            eprintln!("failed to initialise device state: {e}");
        }
    }
    // One-time move from the pre-v8 canonical location in Pictures.
    if !db_path.exists() && state.device_storage.last_library_path().is_none() {
        if let Ok(mut legacy_path) = app.path().picture_dir() {
            legacy_path.push("library.warble");
            if legacy_path.is_file() {
                let _ = state
                    .device_storage
                    .set_last_library_path(Some(&legacy_path));
            }
        }
    }
    // The canonical app-local DB is the working copy. Never overwrite it on
    // every launch from an external source: that can block iOS file-provider
    // access before the webview appears and can also discard newer local
    // edits. The remembered source is only used to seed a missing working DB.
    if !db_path.exists() {
        #[cfg(target_os = "ios")]
        {
            // Resolving an external file-provider bookmark can itself block
            // the iOS launch thread. A missing local working copy therefore
            // always starts empty; the user can explicitly open/import later.
            if state.device_storage.last_library_path().is_some()
                || state.device_storage.library_bookmark().is_some()
            {
                eprintln!("local working library is missing; skipping external auto-open on iOS");
                clear_remembered_library(&state);
            }
        }
        #[cfg(not(target_os = "ios"))]
        restore_last_library(&state, &db_path);
    }

    match open_or_reset_repository(&db_path) {
        Ok((repo, library_id, reset)) => {
            if reset {
                clear_remembered_library(&state);
            }
            let arc = Arc::new(repo);
            state.set_active_library_id(library_id.clone());
            persist_legacy_bindings(arc.as_ref(), &state, &library_id);
            exif_cache::init(Arc::clone(&arc));
            {
                let mut guard = state.repository.lock().expect("repository mutex poisoned");
                *guard = Some(Arc::clone(&arc));
            }
            hydrate_media_roots_after_startup(app, arc, library_id);
        }
        Err(e) => eprintln!(
            "failed to initialise both the saved and fallback libraries at {db_path:?}: {e}"
        ),
    }
}

/// Open and validate the canonical working DB. A malformed/incompatible DB is
/// moved aside for recovery and replaced with a fresh empty library so the app
/// can always reach its UI.
fn open_or_reset_repository(path: &Path) -> Result<(LibraryRepository, String, bool), String> {
    match open_valid_repository(path) {
        Ok((repo, id)) => Ok((repo, id, false)),
        Err(original_error) => {
            if path.exists() {
                let quarantine = quarantine_path(path);
                remove_sqlite_sidecars(path);
                std::fs::rename(path, &quarantine).map_err(|error| {
                    format!(
                        "saved library is invalid ({original_error}) and could not be moved to {}: {error}",
                        quarantine.display()
                    )
                })?;
                eprintln!(
                    "saved library is invalid ({original_error}); moved it to {} and starting empty",
                    quarantine.display()
                );
            } else {
                eprintln!("could not open saved library ({original_error}); starting empty");
            }
            let (repo, id) = open_valid_repository(path)
                .map_err(|error| format!("failed to create empty fallback library: {error}"))?;
            Ok((repo, id, true))
        }
    }
}

fn open_valid_repository(path: &Path) -> Result<(LibraryRepository, String), String> {
    let repo = LibraryRepository::open(path)?;
    let id = repo.library_id()?;
    Ok((repo, id))
}

fn quarantine_path(path: &Path) -> PathBuf {
    path.with_extension(format!("warble.invalid-{}", uuid::Uuid::new_v4()))
}

fn clear_remembered_library(state: &AppState) {
    if let Err(error) = state.device_storage.set_library_source(None, None, None) {
        eprintln!("failed to clear invalid last-library bookmark: {error}");
    }
}

/// If the active DB has a `last_library_path` setting pointing to an
/// existing file different from the active DB, copy that file over
/// the active DB. If the file is gone, clear the setting.
#[cfg(not(target_os = "ios"))]
fn restore_last_library(state: &AppState, db_path: &std::path::Path) {
    let Some(source) = state.device_storage.last_library_path() else {
        return;
    };
    if !source.is_file() {
        eprintln!(
            "last library file no longer exists: {} — starting with existing library",
            source.display()
        );
        clear_remembered_library(state);
        return;
    }
    let staged = db_path.with_extension("warble.startup.tmp");
    let _ = std::fs::remove_file(&staged);
    if let Err(e) = std::fs::copy(&source, &staged) {
        eprintln!(
            "failed to restore last library from {}: {e} — starting empty",
            source.display()
        );
        clear_remembered_library(state);
        return;
    }
    if let Err(error) = open_valid_repository(&staged) {
        eprintln!(
            "last library {} is invalid ({error}) — starting empty",
            source.display()
        );
        let _ = std::fs::remove_file(staged);
        clear_remembered_library(state);
        return;
    }
    remove_sqlite_sidecars(db_path);
    if let Err(error) = std::fs::rename(&staged, db_path) {
        eprintln!(
            "failed to install last library from {}: {error} — starting empty",
            source.display()
        );
        let _ = std::fs::remove_file(staged);
        clear_remembered_library(state);
        return;
    }
    match crate::commands::file_fingerprint(&source) {
        Ok(fingerprint) => {
            if let Err(error) = state.device_storage.set_library_source(
                Some(&source),
                None,
                Some(fingerprint),
            ) {
                eprintln!("failed to remember restored library fingerprint: {error}");
            }
        }
        Err(error) => eprintln!("failed to fingerprint restored library: {error}"),
    }
    eprintln!("restored last library from {}", source.display());
}

fn remove_sqlite_sidecars(db_path: &Path) {
    for suffix in ["-wal", "-shm", "-journal"] {
        let mut p = db_path.as_os_str().to_owned();
        p.push(suffix);
        let _ = std::fs::remove_file(PathBuf::from(p));
    }
}

pub fn init_thumbnail_cache(app: &tauri::App) {
    if let Ok(mut dir) = app.path().app_cache_dir() {
        dir.push("thumbnails");
        let _ = std::fs::create_dir_all(&dir);
        thumbnails::init_cache_dir(dir);
    }
}

pub fn init_hd_image_cache(app: &tauri::App) {
    if let Ok(mut dir) = app.path().app_cache_dir() {
        dir.push("hd_images");
        let _ = std::fs::create_dir_all(&dir);
        hd_image::init_cache_dir(dir);
    }
}

pub fn init_settings_and_caches(app: &tauri::App) {
    let state = app.state::<AppState>();
    state.settings.load_from(&state.device_storage);
    // v0.1 briefly stored cache preferences in the portable library. Remove
    // that legacy row so future saves/exports contain no device tuning.
    if let Ok(repo) = state.repository() {
        let _ = repo.delete_setting("cache_settings");
    }
    let s = state.settings.get();
    thumbnails::set_disk_cache_max_entries(s.thumbnail_disk_max_entries);
    hd_image::set_disk_cache_max_entries(s.hd_image_disk_max_entries);
    full_image::set_memory_cache_capacity(s.full_image_memory_max_entries);
    tasks::pool().set_bg_concurrency(s.background_pool_workers);
}

#[cfg(desktop)]
pub fn init_menu(app: &tauri::App) {
    match menu::build(app.handle()) {
        Ok(m) => {
            if let Err(e) = app.set_menu(m) {
                eprintln!("failed to install application menu: {e}");
            }
        }
        Err(e) => eprintln!("failed to build application menu: {e}"),
    }
}

#[cfg(mobile)]
pub fn init_menu(_app: &tauri::App) {}

pub fn rehydrate_media_roots(repo: &LibraryRepository, state: &AppState) {
    let catalog = scan_media_roots(repo, state);
    if let Ok(mut active) = state.catalog.lock() {
        *active = catalog;
    }
}

/// Scan without holding the shared catalog mutex. The UI can keep rendering
/// an empty/previous catalog while slow external storage is being walked.
fn scan_media_roots(repo: &LibraryRepository, state: &AppState) -> LibraryCatalog {
    let mut catalog = LibraryCatalog::default();
    let Ok(roots) = repo.media_roots() else {
        return catalog;
    };
    let Ok(library_id) = repo.library_id() else {
        return catalog;
    };
    let bindings = state.device_storage.bindings_for(&library_id);
    for root in roots {
        match bindings.get(&root.id) {
            Some(path) if path.is_dir() => {
                if catalog.rehydrate_root(&root.id, &root.name, path).is_err() {
                    catalog.add_unavailable_root(&root.id, &root.name);
                }
            }
            _ => catalog.add_unavailable_root(&root.id, &root.name),
        }
    }
    catalog
}

#[cfg(target_os = "ios")]
fn hydrate_media_roots_after_startup(
    app: &tauri::App,
    repo: Arc<LibraryRepository>,
    library_id: String,
) {
    let app = app.handle().clone();
    // Queue this after setup, then keep bookmark resolution and recursive disk
    // scanning away from the iOS main thread. If either blocks, the shell is
    // already usable and presents an empty library rather than a black screen.
    let queued_app = app.clone();
    let _ = app.run_on_main_thread(move || {
        tauri::async_runtime::spawn_blocking(move || {
            let state = queued_app.state::<AppState>();
            if state.active_library_id().ok().as_deref() != Some(library_id.as_str()) {
                return;
            }
            restore_security_scoped_roots(&queued_app, &state, &library_id);
            let catalog = scan_media_roots(repo.as_ref(), &state);
            if state.active_library_id().ok().as_deref() != Some(library_id.as_str()) {
                return;
            }
            if let Ok(mut active) = state.catalog.lock() {
                *active = catalog;
            }
            let _ = queued_app.emit("library-reloaded", ());
        });
    });
}

#[cfg(not(target_os = "ios"))]
fn hydrate_media_roots_after_startup(
    app: &tauri::App,
    repo: Arc<LibraryRepository>,
    library_id: String,
) {
    let state = app.state::<AppState>();
    restore_security_scoped_roots(app.handle(), &state, &library_id);
    rehydrate_media_roots(repo.as_ref(), &state);
}

fn persist_legacy_bindings(repo: &LibraryRepository, state: &AppState, library_id: &str) {
    let Ok(bindings) = repo.legacy_root_bindings() else {
        return;
    };
    for (root_id, path) in bindings {
        if let Err(e) =
            state
                .device_storage
                .set_root_binding(library_id, &root_id, std::path::Path::new(&path))
        {
            eprintln!("failed to preserve migrated media-root binding: {e}");
            return;
        }
    }
    let _ = repo.clear_legacy_root_bindings();
}

#[cfg(target_os = "ios")]
pub fn restore_security_scoped_roots(app: &tauri::AppHandle, state: &AppState, library_id: &str) {
    for (root_id, bookmark) in state.device_storage.root_bookmarks_for(library_id) {
        match tauri_plugin_folder_access::resolve_bookmark(app, &bookmark) {
            Ok(grant) => {
                let _ = state.device_storage.refresh_root_grant(
                    library_id,
                    &root_id,
                    &bookmark,
                    std::path::Path::new(&grant.path),
                    &grant.bookmark,
                );
            }
            Err(e) => eprintln!("media root {root_id} needs reconnecting: {e}"),
        }
    }
}

#[cfg(not(target_os = "ios"))]
pub fn restore_security_scoped_roots(
    _app: &tauri::AppHandle,
    _state: &AppState,
    _library_id: &str,
) {
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_working_library_is_quarantined_and_replaced() {
        let dir =
            std::env::temp_dir().join(format!("warble-startup-fallback-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("active-library.warble");
        std::fs::write(&path, b"not a sqlite database").unwrap();

        let (repo, library_id, reset) = open_or_reset_repository(&path).unwrap();
        assert!(reset);
        assert!(!library_id.is_empty());
        assert!(repo.media_roots().unwrap().is_empty());
        assert!(dir
            .read_dir()
            .unwrap()
            .flatten()
            .any(|entry| entry.file_name().to_string_lossy().contains(".invalid-")));

        drop(repo);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn valid_working_library_is_kept() {
        let dir =
            std::env::temp_dir().join(format!("warble-startup-valid-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("active-library.warble");
        let original = LibraryRepository::open(&path).unwrap();
        let original_id = original.library_id().unwrap();
        drop(original);

        let (repo, library_id, reset) = open_or_reset_repository(&path).unwrap();
        assert!(!reset);
        assert_eq!(library_id, original_id);

        drop(repo);
        std::fs::remove_dir_all(dir).unwrap();
    }
}

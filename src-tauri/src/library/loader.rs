use crate::app_state;
use crate::imaging;

use app_state::AppState;
#[cfg(target_os = "ios")]
use tauri::Emitter;
use tauri::Manager;

#[cfg(desktop)]
use crate::menu;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::library::{LibraryCatalog, LibraryRepository};
use imaging::{exif_cache, full_image, hd_image, thumbnails};

/// Canonical on-disk location of the active library database.
pub fn library_db_path(app: &tauri::AppHandle) -> PathBuf {
    let mut path = app
        .path()
        .app_data_dir()
        .expect("app data directory is unavailable");
    path.push("active-library.warble");
    path
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
    match open_or_reset_repository(&db_path) {
        Ok((repo, library_id, reset)) => {
            if reset {
                eprintln!("created a fresh local library catalog");
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
        Err(e) => eprintln!("failed to initialise the local library catalog at {db_path:?}: {e}"),
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
                        "local library catalog is invalid ({original_error}) and could not be moved to {}: {error}",
                        quarantine.display()
                    )
                })?;
                eprintln!(
                    "local library catalog is invalid ({original_error}); moved it to {} and starting empty",
                    quarantine.display()
                );
            } else {
                eprintln!(
                    "could not open local library catalog ({original_error}); starting empty"
                );
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
    sync_portable_photo_index(repo, state, &catalog);
    if let Ok(mut active) = state.catalog.lock() {
        *active = catalog;
    }
}

/// Rebuild the local per-photo index from files which travel with the image.
/// Errors are intentionally isolated to one photo: a read-only or temporarily
/// unavailable item must not hide the rest of the media root.
fn sync_portable_photo_index(repo: &LibraryRepository, state: &AppState, catalog: &LibraryCatalog) {
    let mut effects = repo
        .get_setting("photo_effects_v1")
        .ok()
        .flatten()
        .and_then(|raw| {
            serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&raw).ok()
        })
        .unwrap_or_default();
    let original_effects = effects.clone();
    for key in catalog.photo_keys() {
        let result = state.resolve_library_path(&key).and_then(|source| {
            let portable_effects = crate::sidecar::read_effects(&source);
            crate::sidecar::sync_photo_index(repo, &key, &source)?;
            match portable_effects {
                Some(Some(value)) => {
                    effects.insert(key.clone(), value);
                }
                Some(None) => {
                    effects.remove(&key);
                }
                None => {
                    // Do not create an empty file for every photo at startup.
                    // An actual effect, edit, or metadata read will create the
                    // portable sidecar when that image needs one.
                    if let Some(effect) = effects.get(&key) {
                        crate::sidecar::write_effects(&source, Some(effect))?;
                    }
                }
            }
            Ok(())
        });
        if let Err(error) = result {
            eprintln!("failed to sync portable photo state for {key}: {error}");
        }
    }
    if effects != original_effects {
        match serde_json::to_string(&effects) {
            Ok(raw) => {
                if let Err(error) = repo.set_setting("photo_effects_v1", &raw) {
                    eprintln!("failed to update local photo-effects index: {error}");
                }
            }
            Err(error) => eprintln!("failed to serialize local photo-effects index: {error}"),
        }
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
            Some(path) => {
                if let Err(error) = catalog.rehydrate_root(&root.id, &root.name, path) {
                    eprintln!(
                        "failed to scan media root {} at {}: {error}",
                        root.id,
                        path.display()
                    );
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
            sync_portable_photo_index(repo.as_ref(), &state, &catalog);
            if state.active_library_id().ok().as_deref() != Some(library_id.as_str()) {
                return;
            }
            if let Ok(mut active) = state.catalog.lock() {
                *active = catalog;
            }
            let _ = queued_app.emit("folders-rehydrated", ());
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
        match tauri_plugin_folder_access::prepare_folder(app, &bookmark) {
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

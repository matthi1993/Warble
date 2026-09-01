use crate::app_state;
use crate::imaging;

use app_state::AppState;
use tauri::Manager;

#[cfg(desktop)]
use crate::menu;
use crate::tasks;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::library::LibraryRepository;
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
    restore_security_scoped_library(app.handle(), &state);
    restore_last_library(&state, &db_path);

    match LibraryRepository::open(&db_path) {
        Ok(repo) => {
            let arc = Arc::new(repo);
            let library_id = match arc.library_id() {
                Ok(id) => id,
                Err(e) => {
                    eprintln!("failed to read library id: {e}");
                    return;
                }
            };
            state.set_active_library_id(library_id.clone());
            persist_legacy_bindings(arc.as_ref(), &state, &library_id);
            restore_security_scoped_roots(app.handle(), &state, &library_id);
            rehydrate_media_roots(arc.as_ref(), &state);
            exif_cache::init(Arc::clone(&arc));
            {
                let mut guard = state.repository.lock().expect("repository mutex poisoned");
                *guard = Some(arc);
            }
        }
        Err(e) => eprintln!("failed to open library repository at {db_path:?}: {e}"),
    }
}

/// If the active DB has a `last_library_path` setting pointing to an
/// existing file different from the active DB, copy that file over
/// the active DB. If the file is gone, clear the setting.
fn restore_last_library(state: &AppState, db_path: &std::path::Path) {
    let Some(source) = state.device_storage.last_library_path() else {
        return;
    };
    if !source.is_file() {
        eprintln!(
            "last library file no longer exists: {} — starting with existing library",
            source.display()
        );
        return;
    }
    remove_sqlite_sidecars(db_path);
    if let Err(e) = std::fs::copy(&source, db_path) {
        eprintln!(
            "failed to restore last library from {}: {e} — using existing DB",
            source.display()
        );
    } else {
        eprintln!("restored last library from {}", source.display());
    }
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
    if let Ok(repo) = state.repository() {
        state.settings.load_from(repo.as_ref());
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
    let Ok(roots) = repo.media_roots() else {
        return;
    };
    let Ok(library_id) = repo.library_id() else {
        return;
    };
    let bindings = state.device_storage.bindings_for(&library_id);
    let Ok(mut catalog) = state.catalog.lock() else {
        return;
    };
    catalog.reset();
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
            Ok(path) => {
                let _ = state.device_storage.set_root_binding(
                    library_id,
                    &root_id,
                    std::path::Path::new(&path),
                );
            }
            Err(e) => eprintln!("media root {root_id} needs reconnecting: {e}"),
        }
    }
}

#[cfg(target_os = "ios")]
fn restore_security_scoped_library(app: &tauri::AppHandle, state: &AppState) {
    let Some(bookmark) = state.device_storage.library_bookmark() else {
        return;
    };
    match tauri_plugin_folder_access::resolve_bookmark(app, &bookmark) {
        Ok(path) => {
            let _ = state
                .device_storage
                .set_last_library_path(Some(std::path::Path::new(&path)));
        }
        Err(e) => eprintln!("library file needs reopening: {e}"),
    }
}

#[cfg(not(target_os = "ios"))]
fn restore_security_scoped_library(_app: &tauri::AppHandle, _state: &AppState) {}

#[cfg(not(target_os = "ios"))]
pub fn restore_security_scoped_roots(
    _app: &tauri::AppHandle,
    _state: &AppState,
    _library_id: &str,
) {
}

use crate::app_state;
use crate::imaging;

use tauri::Manager;
use app_state::AppState;

use std::path::PathBuf;
use std::sync::Arc;
use crate::menu;
use crate::tasks;

use imaging::{exif_cache, full_image, hd_image, thumbnails};
use crate::library::LibraryRepository;

pub fn init_library_repository(app: &tauri::App) {
    let db_path = app
        .path()
        .picture_dir()
        .ok()
        .map(|mut p| {
            p.push("library.warble");
            p
        })
        .unwrap_or_else(|| PathBuf::from("./library.warble"));
    if let Some(parent) = db_path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            eprintln!("failed to create library dir at {parent:?}: {e}");
        }
    }

    let state = app.state::<AppState>();
    match LibraryRepository::open(&db_path) {
        Ok(repo) => {
            let arc = Arc::new(repo);
            rehydrate_imported_roots(arc.as_ref(), &state);
            exif_cache::init(Arc::clone(&arc));
            let _ = state.repository.set(arc);
        }
        Err(e) => eprintln!("failed to open library repository at {db_path:?}: {e}"),
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
        state.settings.load_from(repo);
    }
    let s = state.settings.get();
    thumbnails::set_disk_cache_max_entries(s.thumbnail_disk_max_entries);
    hd_image::set_disk_cache_max_entries(s.hd_image_disk_max_entries);
    full_image::set_memory_cache_capacity(s.full_image_memory_max_entries);
    tasks::pool().set_bg_concurrency(s.background_pool_workers);
}

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

fn rehydrate_imported_roots(repo: &LibraryRepository, state: &AppState) {
    let Ok(paths) = repo.imported_root_paths() else {
        return;
    };
    let Ok(mut catalog) = state.catalog.lock() else {
        return;
    };
    for path in paths {
        let _ = catalog.rehydrate_root(&PathBuf::from(path));
    }
}

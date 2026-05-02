mod app_state;
mod caching;
mod commands;
mod imaging;
mod library;
mod menu;
mod settings;

use std::path::PathBuf;

use tauri::Manager;

use app_state::AppState;
use imaging::{full_image, thumbnails};
use library::LibraryRepository;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            init_thumbnail_cache(app);
            init_library_repository(app);
            init_settings_and_caches(app);
            init_menu(app);
            Ok(())
        })
        .on_menu_event(|app, event| menu::handle_event(app, event))
        .invoke_handler(tauri::generate_handler![
            commands::select_folders_dialog,
            commands::import_folder,
            commands::list_imported_folders,
            commands::get_photos_in_folder,
            commands::get_thumbnail,
            commands::get_full_image_bytes,
            commands::get_cache_settings,
            commands::set_thumbnail_cache_max,
            commands::set_full_image_memory_cache_max,
            commands::set_full_image_bitmap_cache_max,
            commands::clear_thumbnail_cache,
            commands::clear_full_image_memory_cache,
            commands::reveal_in_file_manager,
            commands::get_photo_variants,
            commands::set_photo_variant,
            commands::get_last_folder,
            commands::set_last_folder,
            commands::get_view_state,
            commands::set_view_state,
            commands::get_app_view,
            commands::set_app_view,
            commands::get_photo_edits,
            commands::set_photo_edit,
            commands::clear_photo_edit,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn init_thumbnail_cache(app: &tauri::App) {
    if let Ok(mut dir) = app.path().app_cache_dir() {
        dir.push("thumbnails");
        let _ = std::fs::create_dir_all(&dir);
        thumbnails::init_cache_dir(dir);
    }
}

/// Load persisted cache settings (or defaults), then apply them to every
/// in-memory and on-disk cache before the app processes its first request.
/// Must run *after* `init_library_repository` because settings live in the
/// SQLite library DB.
fn init_settings_and_caches(app: &tauri::App) {
    let state = app.state::<AppState>();
    if let Ok(repo) = state.repository() {
        state.settings.load_from(repo);
    }
    let s = state.settings.get();
    thumbnails::set_disk_cache_max_entries(s.thumbnail_disk_max_entries);
    full_image::set_memory_cache_capacity(s.full_image_memory_max_entries);
}

fn init_menu(app: &tauri::App) {
    match menu::build(app.handle()) {
        Ok(m) => {
            if let Err(e) = app.set_menu(m) {
                eprintln!("failed to install application menu: {e}");
            }
        }
        Err(e) => eprintln!("failed to build application menu: {e}"),
    }
}

fn init_library_repository(app: &tauri::App) {
    let mut db_path = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    db_path.push("warble.db");

    let state = app.state::<AppState>();
    match LibraryRepository::open(&db_path) {
        Ok(repo) => {
            rehydrate_imported_roots(&repo, &state);
            let _ = state.repository.set(repo);
        }
        Err(e) => eprintln!("failed to open library repository at {db_path:?}: {e}"),
    }
}

/// Walk every previously imported root from disk so the in-memory catalog is
/// populated on startup. The DB only stores the root paths; the file listing
/// is rebuilt fresh each launch.
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

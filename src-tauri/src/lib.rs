mod app_state;
mod caching;
mod commands;
mod imaging;
mod library;

use std::path::PathBuf;

use tauri::Manager;

use app_state::AppState;
use imaging::thumbnails;
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::select_folders_dialog,
            commands::import_folder,
            commands::list_imported_folders,
            commands::get_photos_in_folder,
            commands::get_thumbnail,
            commands::get_full_image_bytes,
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

fn init_library_repository(app: &tauri::App) {
    let mut db_path = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    db_path.push("photoflow.db");

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

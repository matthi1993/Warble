mod commands;
mod domain;
mod infrastructure;
mod state;

use std::path::PathBuf;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(state::AppState::default())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Initialise the on-disk thumbnail cache under the app cache dir.
            if let Ok(mut dir) = app.path().app_cache_dir() {
                dir.push("thumbnails");
                let _ = std::fs::create_dir_all(&dir);
                infrastructure::thumbnail::init_cache_dir(dir);
            }

            // Open the SQLite metadata database under the app data dir.
            let mut db_path = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            db_path.push("photoflow.db");

            let state = app.state::<state::AppState>();
            match infrastructure::db::Database::open(&db_path) {
                Ok(db) => {
                    // Re-hydrate previously imported folder roots by walking
                    // them again from disk. The DB only stores the root paths;
                    // the actual file listing is rebuilt in memory.
                    if let Ok(rows) = db.list_imported_folders() {
                        if let Ok(mut inner) = state.inner.lock() {
                            for row in rows {
                                let root = PathBuf::from(&row.path);
                                if let Ok(folder) =
                                    commands::walk_folder(&root, &mut inner.photos)
                                {
                                    inner.imported_folders.push(folder);
                                }
                            }
                        }
                    }
                    let _ = state.db.set(db);
                }
                Err(e) => {
                    eprintln!("failed to open database at {db_path:?}: {e}");
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            commands::select_folder_dialog,
            commands::select_folders_dialog,
            commands::import_folder,
            commands::list_imported_folders,
            commands::get_photos_in_folder,
            commands::get_thumbnail,
            commands::get_full_image,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

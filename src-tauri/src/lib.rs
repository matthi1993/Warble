mod commands;
mod domain;
mod infrastructure;
mod state;

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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            commands::select_folder_dialog,
            commands::select_folders_dialog,
            commands::import_folder,
            commands::get_photos_in_folder,
            commands::get_thumbnail,
            commands::get_full_image,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

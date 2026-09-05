mod app_state;
mod caching;
mod commands;
mod device_storage;
mod imaging;
mod library;
#[cfg(desktop)]
mod menu;
mod settings;
mod tasks;

use app_state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "ios")]
    let builder = builder.plugin(tauri_plugin_folder_access::init());
    let builder = builder
        .manage(AppState::default())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Spin up the priority task pool early so worker threads
            // are warm before the first image request.
            let _ = tasks::pool();
            library::init_thumbnail_cache(app);
            library::init_hd_image_cache(app);
            library::init_library_repository(app);
            library::init_settings_and_caches(app);
            library::init_menu(app);
            Ok(())
        });
    #[cfg(desktop)]
    let builder = builder.on_menu_event(|app, event| menu::handle_event(app, event));
    builder
        .invoke_handler(tauri::generate_handler![
            commands::select_folders_dialog,
            commands::import_folder,
            commands::bind_media_root,
            commands::list_imported_folders,
            commands::refresh_imported_folders,
            commands::refresh_folder,
            commands::remove_imported_folder,
            commands::get_photos_in_folder,
            commands::get_thumbnail,
            commands::get_full_image_bytes,
            commands::get_raw_image_bytes,
            commands::get_hd_image_bytes,
            commands::cancel_image_request,
            commands::get_exif_metadata,
            commands::get_cache_settings,
            commands::set_thumbnail_cache_max,
            commands::set_hd_image_cache_max,
            commands::set_full_image_memory_cache_max,
            commands::set_full_image_bitmap_cache_max,
            commands::clear_thumbnail_cache,
            commands::clear_hd_image_cache,
            commands::clear_full_image_memory_cache,
            commands::set_background_pool_workers,
            commands::set_cache_settings,
            commands::get_cache_disk_usage,
            commands::get_task_stats,
            commands::cancel_all_tasks,
            commands::reveal_in_file_manager,
            commands::get_photo_variants,
            commands::set_photo_variant,
            commands::get_last_folder,
            commands::set_last_folder,
            commands::get_view_state,
            commands::set_view_state,
            commands::get_app_view,
            commands::set_app_view,
            commands::get_post_process_presets,
            commands::set_post_process_presets,
            commands::get_photo_effects,
            commands::set_photo_effects,
            commands::get_photo_edits,
            commands::set_photo_edit,
            commands::clear_photo_edit,
            commands::get_photo_ratings,
            commands::set_photo_rating,
            commands::get_open_library_path,
            commands::select_library_dialog,
            commands::save_library,
            commands::save_library_as,
            commands::save_open_library,
            commands::load_library,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

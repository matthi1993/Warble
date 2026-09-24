mod app_state;
mod caching;
mod commands;
mod device_storage;
mod imaging;
mod library;
#[cfg(desktop)]
mod menu;
mod settings;
mod sidecar;
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
            commands::import_folders,
            commands::bind_media_root,
            commands::list_imported_folders,
            commands::refresh_imported_folders,
            commands::refresh_folder,
            commands::index_folder_images,
            commands::refresh_photo_parent,
            commands::remove_imported_folder,
            commands::reset_workspace,
            commands::get_photos_in_folder,
            commands::get_folder_photo_counts,
            commands::get_all_photos,
            commands::get_thumbnail,
            commands::get_full_image_bytes,
            commands::get_hd_image_bytes,
            commands::cancel_image_request,
            commands::promote_image_request,
            commands::get_exif_metadata,
            commands::set_photo_metadata,
            commands::get_cached_photo_filter_metadata,
            commands::get_photo_filter_metadata,
            commands::get_cache_settings,
            commands::set_thumbnail_cache_max,
            commands::set_hd_image_cache_max,
            commands::set_full_image_memory_cache_max,
            commands::set_full_image_bitmap_cache_max,
            commands::clear_thumbnail_cache,
            commands::clear_hd_image_cache,
            commands::clear_full_image_memory_cache,
            commands::set_cache_settings,
            commands::get_cache_disk_usage,
            commands::reveal_in_file_manager,
            commands::open_photo_in_app,
            commands::open_raw_in_default_app,
            commands::get_photo_variants,
            commands::set_photo_variant,
            commands::photo_variant_exists,
            commands::save_photo_variant,
            commands::trash_photo_variant,
            commands::trash_photo_group,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

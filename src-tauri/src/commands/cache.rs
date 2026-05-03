//! Tauri commands exposing user-tunable cache settings to the frontend.

use tauri::{Emitter, State};

use crate::app_state::AppState;
use crate::imaging::{full_image, hd_image, thumbnails};
use crate::settings::CacheSettings;

#[tauri::command]
pub fn get_cache_settings(state: State<'_, AppState>) -> CacheSettings {
    state.settings.get()
}

#[tauri::command]
pub fn set_thumbnail_cache_max(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    max: usize,
) -> Result<CacheSettings, String> {
    let repo = state.repository()?;
    let snapshot = state
        .settings
        .update(repo, |s| s.thumbnail_disk_max_entries = max);
    thumbnails::set_disk_cache_max_entries(max);
    let _ = app.emit("cache-settings-changed", snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub fn set_hd_image_cache_max(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    max: usize,
) -> Result<CacheSettings, String> {
    let repo = state.repository()?;
    let snapshot = state
        .settings
        .update(repo, |s| s.hd_image_disk_max_entries = max);
    hd_image::set_disk_cache_max_entries(max);
    let _ = app.emit("cache-settings-changed", snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub fn set_full_image_memory_cache_max(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    max: usize,
) -> Result<CacheSettings, String> {
    let repo = state.repository()?;
    let snapshot = state
        .settings
        .update(repo, |s| s.full_image_memory_max_entries = max);
    full_image::set_memory_cache_capacity(max);
    let _ = app.emit("cache-settings-changed", snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub fn set_full_image_bitmap_cache_max(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    max: usize,
) -> Result<CacheSettings, String> {
    let repo = state.repository()?;
    let snapshot = state
        .settings
        .update(repo, |s| s.full_image_bitmap_max_entries = max);
    let _ = app.emit("cache-settings-changed", snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub fn clear_thumbnail_cache(app: tauri::AppHandle) {
    thumbnails::clear_disk_cache();
    let _ = app.emit("cache-cleared", "thumbnail_disk");
}

#[tauri::command]
pub fn clear_hd_image_cache(app: tauri::AppHandle) {
    hd_image::clear_disk_cache();
    let _ = app.emit("cache-cleared", "hd_image_disk");
}

#[tauri::command]
pub fn clear_full_image_memory_cache(app: tauri::AppHandle) {
    full_image::clear_memory_cache();
    let _ = app.emit("cache-cleared", "full_image_memory");
}

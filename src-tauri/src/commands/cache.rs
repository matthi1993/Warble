//! Tauri commands exposing user-tunable cache settings to the frontend.

use serde::Serialize;
use tauri::{Emitter, State};

use crate::app_state::AppState;
use crate::imaging::{full_image, hd_image, thumbnails};
use crate::settings::CacheSettings;
use crate::tasks;

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
        .update(&repo, |s| s.thumbnail_disk_max_entries = max);
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
        .update(&repo, |s| s.hd_image_disk_max_entries = max);
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
        .update(&repo, |s| s.full_image_memory_max_entries = max);
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
        .update(&repo, |s| s.full_image_bitmap_max_entries = max);
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

#[tauri::command]
pub fn set_background_pool_workers(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    workers: usize,
) -> Result<CacheSettings, String> {
    let repo = state.repository()?;
    let cap = tasks::pool().bg_thread_capacity().max(1);
    let clamped = workers.clamp(1, cap);
    let snapshot = state
        .settings
        .update(&repo, |s| s.background_pool_workers = clamped);
    tasks::pool().set_bg_concurrency(clamped);
    let _ = app.emit("cache-settings-changed", snapshot);
    Ok(snapshot)
}

#[derive(Clone, Debug, Serialize)]
pub struct CacheDiskUsageEntry {
    /// Filesystem path of the cache directory, or `None` if the cache
    /// hasn't been initialised yet.
    pub path: Option<String>,
    /// Total bytes occupied by every cached entry in this cache.
    pub bytes: u64,
    /// Number of cached files.
    pub files: usize,
}

#[derive(Clone, Debug, Serialize)]
pub struct CacheDiskUsage {
    pub thumbnail: CacheDiskUsageEntry,
    pub hd_image: CacheDiskUsageEntry,
    /// Maximum value `set_background_pool_workers` will accept.
    pub bg_thread_capacity: usize,
}

#[tauri::command]
pub async fn get_cache_disk_usage() -> Result<CacheDiskUsage, String> {
    // Walking the cache shards is blocking I/O — keep the async
    // command runtime free.
    tauri::async_runtime::spawn_blocking(|| {
        let (thumb_bytes, thumb_files) = thumbnails::cache_disk_usage().unwrap_or((0, 0));
        let (hd_bytes, hd_files) = hd_image::cache_disk_usage().unwrap_or((0, 0));
        CacheDiskUsage {
            thumbnail: CacheDiskUsageEntry {
                path: thumbnails::cache_root_path()
                    .map(|p| p.to_string_lossy().into_owned()),
                bytes: thumb_bytes,
                files: thumb_files,
            },
            hd_image: CacheDiskUsageEntry {
                path: hd_image::cache_root_path()
                    .map(|p| p.to_string_lossy().into_owned()),
                bytes: hd_bytes,
                files: hd_files,
            },
            bg_thread_capacity: tasks::pool().bg_thread_capacity(),
        }
    })
    .await
    .map_err(|e| e.to_string())
}

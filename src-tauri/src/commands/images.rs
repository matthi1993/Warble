//! Tauri commands for image rendering: thumbnails and full-resolution
//! bytes for the canvas viewer.

use tauri::ipc::Response;

use crate::imaging::{full_image, thumbnails};

#[tauri::command]
pub async fn get_thumbnail(photo_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || thumbnails::render(&photo_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_full_image_bytes(photo_path: String) -> Result<Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || full_image::load_bytes(&photo_path))
        .await
        .map_err(|e| e.to_string())??;
    Ok(Response::new(bytes))
}

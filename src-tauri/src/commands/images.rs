//! Tauri commands for image rendering: thumbnails and full-resolution
//! bytes for the canvas viewer.
//!
//! Non-destructive edits (crop, etc.) are intentionally NOT applied
//! here. The frontend canvas applies them at render time on the
//! decoded `ImageBitmap`, which is format-agnostic and free — no
//! decode/re-encode round trip per save. The backend's only job is
//! to hand the canvas the original decoded bytes (or, for RAW, the
//! developed preview bytes).

use std::path::PathBuf;

use tauri::ipc::Response;

use crate::imaging::{exif, full_image, thumbnails};

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

/// Read EXIF metadata for the photo at `photo_path`. Returns an
/// `ExifMetadata` with `null` for any tags that aren't present so the
/// frontend can decide whether to render each row.
#[tauri::command]
pub async fn get_exif_metadata(
    photo_path: String,
) -> Result<exif::ExifMetadata, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok::<_, String>(exif::read_metadata(&PathBuf::from(photo_path)))
    })
    .await
    .map_err(|e| e.to_string())?
}

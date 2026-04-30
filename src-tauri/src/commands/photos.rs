use tauri::ipc::Response;

use crate::infrastructure::full_image::{
    load_full_image, load_full_image_bytes, load_full_image_pixels,
};
use crate::infrastructure::thumbnail::generate_thumbnail;

#[tauri::command]
pub async fn get_thumbnail(photo_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || generate_thumbnail(&photo_path))
        .await
        .map_err(|e| e.to_string())?
}

/// Legacy: returns base64-encoded JPEG bytes. Retained for any callers that
/// haven't migrated to the binary pixel path yet.
#[tauri::command]
pub async fn get_full_image(photo_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || load_full_image(&photo_path))
        .await
        .map_err(|e| e.to_string())?
}

/// Decode the file to RGBA8 and return a binary blob:
/// `[u32 width][u32 height][u32 format][u32 color_space][pixels…]` (LE).
///
/// Tauri ships this as raw bytes (zero-copy `ArrayBuffer` on the JS side),
/// avoiding the ~33% base64 inflation and JSON-string round-trip.
#[tauri::command]
pub async fn get_full_image_pixels(photo_path: String) -> Result<Response, String> {
    let blob = tauri::async_runtime::spawn_blocking(move || {
        load_full_image_pixels(&photo_path).map(|img| img.into_blob())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(Response::new(blob))
}

/// Returns the *encoded* image bytes (JPEG/PNG) so the frontend can decode
/// via the browser's native, multi-threaded `createImageBitmap`. Avoids the
/// ~96 MB RGBA round-trip per 24 MP image. RAW files yield their embedded
/// JPEG preview; TIFF is transcoded to JPEG once and cached.
#[tauri::command]
pub async fn get_full_image_bytes(photo_path: String) -> Result<Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || load_full_image_bytes(&photo_path))
        .await
        .map_err(|e| e.to_string())??;
    Ok(Response::new(bytes))
}

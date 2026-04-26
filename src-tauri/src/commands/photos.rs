use crate::infrastructure::full_image::load_full_image;
use crate::infrastructure::thumbnail::generate_thumbnail;

#[tauri::command]
pub async fn get_thumbnail(photo_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || generate_thumbnail(&photo_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_full_image(photo_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || load_full_image(&photo_path))
        .await
        .map_err(|e| e.to_string())?
}

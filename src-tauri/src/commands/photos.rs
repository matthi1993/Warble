use crate::infrastructure::thumbnail::generate_thumbnail;

#[tauri::command]
pub async fn get_thumbnail(photo_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || generate_thumbnail(&photo_path))
        .await
        .map_err(|e| e.to_string())?
}

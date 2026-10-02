use std::collections::HashSet;

use serde::Serialize;
use tauri::State;

use crate::app_state::AppState;
use crate::library::Photo;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumDto {
    id: String,
    name: String,
    description: String,
    photo_count: i64,
}

#[tauri::command]
pub fn list_albums(state: State<'_, AppState>) -> Result<Vec<AlbumDto>, String> {
    Ok(state
        .repository()?
        .albums()?
        .into_iter()
        .map(|(id, name, description, photo_count)| AlbumDto {
            id,
            name,
            description,
            photo_count,
        })
        .collect())
}

#[tauri::command]
pub fn create_album(
    name: String,
    description: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Album name is required".into());
    }
    state.repository()?.create_album(name, description.trim())
}

#[tauri::command]
pub fn update_album(
    id: String,
    name: String,
    description: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Album name is required".into());
    }
    state
        .repository()?
        .update_album(&id, name, description.trim())
}

#[tauri::command]
pub fn delete_album(id: String, state: State<'_, AppState>) -> Result<(), String> {
    state.repository()?.delete_album(&id)
}

#[tauri::command]
pub fn get_album_photos(id: String, state: State<'_, AppState>) -> Result<Vec<Photo>, String> {
    let paths: HashSet<String> = state
        .repository()?
        .album_photo_paths(&id)?
        .into_iter()
        .collect();
    let catalog = state.catalog.lock().map_err(|e| e.to_string())?;
    Ok(catalog
        .all_photos()
        .into_iter()
        .filter(|photo| paths.contains(&photo.path))
        .collect())
}

#[tauri::command]
pub fn add_photos_to_album(
    id: String,
    photo_paths: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let catalog = state.catalog.lock().map_err(|e| e.to_string())?;
    let available: HashSet<String> = catalog
        .all_photos()
        .into_iter()
        .map(|photo| photo.path)
        .collect();
    if photo_paths.iter().any(|path| !available.contains(path)) {
        return Err("One or more photos are no longer in the library".into());
    }
    drop(catalog);
    state.repository()?.add_photos_to_album(&id, &photo_paths)
}

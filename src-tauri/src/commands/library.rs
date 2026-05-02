//! Tauri commands for the photo library: folder picking, importing roots,
//! listing imported roots, and listing photos inside a folder.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::app_state::AppState;
use crate::library::{Folder, Photo};

#[tauri::command]
pub async fn select_folders_dialog(app: AppHandle) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .blocking_pick_folders()
            .map(|paths| paths.into_iter().map(|p| p.to_string()).collect())
            .unwrap_or_default()
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub fn import_folder(path: String, state: State<'_, AppState>) -> Result<Folder, String> {
    let root = PathBuf::from(&path);
    let mut catalog = state.catalog.lock().map_err(|e| e.to_string())?;
    let folder = catalog.import_root(&root)?;
    drop(catalog);
    state.repository()?.record_imported_root(&path)?;
    Ok(folder)
}

#[tauri::command]
pub fn list_imported_folders(state: State<'_, AppState>) -> Result<Vec<Folder>, String> {
    let catalog = state.catalog.lock().map_err(|e| e.to_string())?;
    Ok(catalog.roots())
}

#[tauri::command]
pub fn get_photos_in_folder(
    folder_path: String,
    state: State<'_, AppState>,
) -> Result<Vec<Photo>, String> {
    let catalog = state.catalog.lock().map_err(|e| e.to_string())?;
    Ok(catalog.photos_in_folder(Path::new(&folder_path)))
}

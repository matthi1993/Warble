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

/// Re-scan every previously imported root from disk. Used by the
/// "Refresh" button next to "Add Folders" so the sidebar picks up
/// new files added outside the app.
#[tauri::command]
pub fn refresh_imported_folders(state: State<'_, AppState>) -> Result<Vec<Folder>, String> {
    let paths = state.repository()?.imported_root_paths()?;
    let mut catalog = state.catalog.lock().map_err(|e| e.to_string())?;
    catalog.reset();
    for path in &paths {
        let _ = catalog.rehydrate_root(&PathBuf::from(path));
    }
    Ok(catalog.roots())
}

#[tauri::command]
pub fn get_photos_in_folder(
    folder_path: String,
    recursive: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Vec<Photo>, String> {
    let catalog = state.catalog.lock().map_err(|e| e.to_string())?;
    Ok(catalog.photos_in_folder_filtered(Path::new(&folder_path), recursive.unwrap_or(false)))
}

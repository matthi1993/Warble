//! Tauri commands for the photo library: folder picking, importing roots,
//! listing imported roots, and listing photos inside a folder.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
#[cfg(not(any(target_os = "ios", target_os = "android")))]
use tauri_plugin_dialog::DialogExt;

use crate::app_state::AppState;
use crate::library::{Folder, Photo};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderSelection {
    pub path: String,
    pub bookmark: Option<String>,
}

#[tauri::command]
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub async fn select_folders_dialog(app: AppHandle) -> Vec<FolderSelection> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .blocking_pick_folders()
            .map(|paths| {
                paths
                    .into_iter()
                    .map(|p| FolderSelection {
                        path: p.to_string(),
                        bookmark: None,
                    })
                    .collect()
            })
            .unwrap_or_default()
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
#[cfg(target_os = "ios")]
pub async fn select_folders_dialog(app: AppHandle) -> Result<Vec<FolderSelection>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        tauri_plugin_folder_access::pick_folders(&app, true).map(|folders| {
            folders
                .into_iter()
                .map(|folder| FolderSelection {
                    path: folder.path,
                    bookmark: Some(folder.bookmark),
                })
                .collect()
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
#[cfg(target_os = "android")]
pub async fn select_folders_dialog(_app: AppHandle) -> Result<Vec<FolderSelection>, String> {
    Err("Folder access is not implemented on Android".to_string())
}

#[tauri::command]
pub fn import_folder(
    path: String,
    bookmark: Option<String>,
    state: State<'_, AppState>,
) -> Result<Folder, String> {
    let root = std::fs::canonicalize(PathBuf::from(&path)).map_err(|e| e.to_string())?;
    if !root.is_dir() {
        return Err(format!("media root is not a directory: {}", root.display()));
    }
    let repo = state.repository()?;
    let library_id = repo.library_id()?;
    reject_overlapping_root(
        &root,
        state.device_storage.bindings_for(&library_id).values(),
    )?;
    let root_id = uuid::Uuid::new_v4().to_string();
    let name = root
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("Photos")
        .to_string();
    let mut catalog = state.catalog.lock().map_err(|e| e.to_string())?;
    let folder = catalog.import_root(&root_id, &name, &root)?;
    drop(catalog);
    state
        .device_storage
        .set_root_binding(&library_id, &root_id, &root)?;
    if let Some(bookmark) = bookmark {
        state
            .device_storage
            .set_root_bookmark(&library_id, &root_id, &bookmark)?;
    }
    repo.add_media_root(&root_id, &name)?;
    Ok(folder)
}

/// Reconnect a root from a library created on another device.
#[tauri::command]
pub fn bind_media_root(
    root_id: String,
    path: String,
    bookmark: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<Folder>, String> {
    let root_path = std::fs::canonicalize(PathBuf::from(path)).map_err(|e| e.to_string())?;
    if !root_path.is_dir() {
        return Err("selected media root is not a directory".to_string());
    }
    let repo = state.repository()?;
    let media_root = repo
        .media_roots()?
        .into_iter()
        .find(|root| root.id == root_id)
        .ok_or_else(|| "unknown media-root UUID".to_string())?;
    let library_id = repo.library_id()?;
    let bindings = state.device_storage.bindings_for(&library_id);
    reject_overlapping_root(
        &root_path,
        bindings
            .iter()
            .filter(|(id, _)| *id != &root_id)
            .map(|(_, path)| path),
    )?;
    // Verify that this folder is at least readable before remembering access.
    std::fs::read_dir(&root_path).map_err(|e| e.to_string())?;
    state
        .device_storage
        .set_root_binding(&library_id, &media_root.id, &root_path)?;
    if let Some(bookmark) = bookmark {
        state
            .device_storage
            .set_root_bookmark(&library_id, &media_root.id, &bookmark)?;
    }
    crate::library::rehydrate_media_roots(repo.as_ref(), &state);
    list_imported_folders(state)
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
    let repo = state.repository()?;
    crate::library::rehydrate_media_roots(repo.as_ref(), &state);
    list_imported_folders(state)
}

fn reject_overlapping_root<'a>(
    candidate: &Path,
    existing: impl Iterator<Item = &'a PathBuf>,
) -> Result<(), String> {
    for other in existing {
        let Ok(other) = std::fs::canonicalize(other) else {
            continue;
        };
        if candidate.starts_with(&other) || other.starts_with(candidate) {
            return Err(format!(
                "media roots may not overlap: {} and {}",
                candidate.display(),
                other.display()
            ));
        }
    }
    Ok(())
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

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::domain::folders::Folder;
use crate::domain::photos::Photo;
use crate::state::AppState;

const PHOTO_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "tiff", "raf", "raw", "arw", "cr2", "cr3", "nef",
];

#[tauri::command]
pub async fn select_folder_dialog(app: AppHandle) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .blocking_pick_folder()
            .map(|p| p.to_string())
    })
    .await
    .ok()
    .flatten()
}

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
    let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
    let folder = walk_folder(&root, &mut inner.photos)?;
    inner.imported_folders.push(folder.clone());
    Ok(folder)
}

#[tauri::command]
pub fn get_photos_in_folder(
    folder_path: String,
    state: State<'_, AppState>,
) -> Result<Vec<Photo>, String> {
    let inner = state.inner.lock().map_err(|e| e.to_string())?;
    let folder = Path::new(&folder_path);
    let mut result: Vec<Photo> = inner
        .photos
        .values()
        .filter(|p| Path::new(&p.path).parent() == Some(folder))
        .cloned()
        .collect();
    result.sort_by(|a, b| a.filename.cmp(&b.filename));
    Ok(result)
}

fn walk_folder(path: &Path, photos: &mut HashMap<String, Photo>) -> Result<Folder, String> {
    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;
    let mut children = Vec::new();

    for entry in entries.flatten() {
        let entry_path = entry.path();
        if entry_path.is_dir() {
            if let Ok(child) = walk_folder(&entry_path, photos) {
                children.push(child);
            }
        } else if entry_path.is_file() {
            let Some(ext) = entry_path.extension().and_then(|e| e.to_str()) else {
                continue;
            };
            let ext_lower = ext.to_ascii_lowercase();
            if !PHOTO_EXTENSIONS.iter().any(|e| *e == ext_lower) {
                continue;
            }
            let filename = entry_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default()
                .to_string();
            let photo_path = entry_path.to_string_lossy().into_owned();
            photos.insert(
                photo_path.clone(),
                Photo {
                    path: photo_path,
                    filename,
                },
            );
        }
    }

    children.sort_by(|a, b| a.name.cmp(&b.name));

    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_else(|| path.to_str().unwrap_or_default())
        .to_string();
    let id = path.to_string_lossy().into_owned();

    Ok(Folder {
        id,
        path: path.to_path_buf(),
        name,
        children,
    })
}

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

/// Viewable extensions, in preference order. Used to pick a primary file when
/// multiple files share the same stem (e.g. a JPEG + RAW pair).
const VIEWABLE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "tiff"];

fn extension_rank(ext: &str) -> usize {
    VIEWABLE_EXTENSIONS
        .iter()
        .position(|e| *e == ext)
        .unwrap_or(VIEWABLE_EXTENSIONS.len())
}

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

    // Collect all photos in the folder, then group entries that share a stem
    // (case-insensitive) so a JPEG/RAW pair shows up as a single thumbnail.
    let mut groups: HashMap<String, Vec<&Photo>> = HashMap::new();
    for photo in inner.photos.values() {
        let entry_path = Path::new(&photo.path);
        if entry_path.parent() != Some(folder) {
            continue;
        }
        let key = entry_path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_else(|| photo.filename.to_ascii_lowercase());
        groups.entry(key).or_default().push(photo);
    }

    let mut result: Vec<Photo> = groups
        .into_values()
        .map(|mut members| {
            // Pick the primary entry: prefer viewable formats, then
            // alphabetical extension as a stable tiebreaker.
            members.sort_by(|a, b| {
                let ea = Path::new(&a.path)
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.to_ascii_lowercase())
                    .unwrap_or_default();
                let eb = Path::new(&b.path)
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.to_ascii_lowercase())
                    .unwrap_or_default();
                extension_rank(&ea)
                    .cmp(&extension_rank(&eb))
                    .then_with(|| ea.cmp(&eb))
            });

            let mut extensions: Vec<String> = members
                .iter()
                .filter_map(|p| {
                    Path::new(&p.path)
                        .extension()
                        .and_then(|e| e.to_str())
                        .map(|e| e.to_ascii_lowercase())
                })
                .collect();
            extensions.dedup();

            let primary = members[0];
            Photo {
                path: primary.path.clone(),
                filename: primary.filename.clone(),
                extensions,
            }
        })
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
                    extensions: vec![ext_lower],
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

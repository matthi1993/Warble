//! Tauri commands for the photo library: folder picking, importing roots,
//! listing imported roots, and listing photos inside a folder.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
#[cfg(not(any(target_os = "ios", target_os = "android")))]
use tauri_plugin_dialog::DialogExt;

use crate::app_state::AppState;
use crate::library::{Folder, LibraryCatalog, Photo};

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
    app: AppHandle,
    path: String,
    bookmark: Option<String>,
    state: State<'_, AppState>,
) -> Result<Folder, String> {
    let (path, bookmark) = prepare_selected_folder(&app, path, bookmark)?;
    import_folder_inner(path, bookmark, &state)
}

fn import_folder_inner(
    path: String,
    bookmark: Option<String>,
    state: &AppState,
) -> Result<Folder, String> {
    let root = std::fs::canonicalize(PathBuf::from(&path)).map_err(|e| e.to_string())?;
    if !root.is_dir() {
        return Err(format!("media root is not a directory: {}", root.display()));
    }
    let repo = state.repository()?;
    let library_id = repo.library_id()?;
    let name = root
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("Photos")
        .to_string();
    let bindings = state.device_storage.bindings_for(&library_id);
    let media_roots = repo.media_roots()?;

    // If an imported parent already covers this selection, keep the parent.
    // Selecting the exact same root also refreshes its iOS bookmark.
    for (existing_id, existing_path) in &bindings {
        let Ok(existing_path) = std::fs::canonicalize(existing_path) else {
            continue;
        };
        if root.starts_with(&existing_path) {
            if root == existing_path {
                if let Some(bookmark) = bookmark.as_deref() {
                    state.device_storage.set_root_grant(
                        &library_id,
                        existing_id,
                        &existing_path,
                        Some(bookmark),
                    )?;
                }
            }
            return state
                .catalog
                .lock()
                .map_err(|e| e.to_string())?
                .roots()
                .into_iter()
                .find(|folder| folder.id == *existing_id)
                .ok_or_else(|| "existing media root is not loaded".to_string());
        }
    }

    // On a second device the old roots are intentionally stored without
    // absolute paths. Picking a folder with the same name reconnects that
    // single root instead of creating a duplicate.
    if let Some(existing) = media_roots
        .iter()
        .find(|entry| !bindings.contains_key(&entry.id) && entry.name == name)
    {
        state.device_storage.set_root_grant(
            &library_id,
            &existing.id,
            &root,
            bookmark.as_deref(),
        )?;
        crate::library::rehydrate_media_roots(repo.as_ref(), state);
        return state
            .catalog
            .lock()
            .map_err(|e| e.to_string())?
            .roots()
            .into_iter()
            .find(|folder| folder.id == existing.id)
            .ok_or_else(|| "reconnected media root is not loaded".to_string());
    }

    // Find existing child roots. Connected roots are matched by canonical
    // path; unavailable roots from another device can be matched to direct
    // children by their portable display name.
    let mut rewrites: Vec<(String, String)> = Vec::new();
    for (existing_id, existing_path) in &bindings {
        let Ok(existing_path) = std::fs::canonicalize(existing_path) else {
            continue;
        };
        if existing_path.starts_with(&root) && existing_path != root {
            let relative = existing_path
                .strip_prefix(&root)
                .map_err(|e| e.to_string())?;
            rewrites.push((existing_id.clone(), portable_relative(relative)?));
        }
    }
    for existing in &media_roots {
        if bindings.contains_key(&existing.id) || rewrites.iter().any(|(id, _)| id == &existing.id)
        {
            continue;
        }
        if root.join(&existing.name).is_dir() {
            rewrites.push((existing.id.clone(), existing.name.clone()));
        }
    }

    let root_id = uuid::Uuid::new_v4().to_string();
    // Scan before changing persistence so an unreadable parent cannot remove
    // otherwise usable child imports.
    let mut scanned = LibraryCatalog::default();
    let folder = scanned.import_root(&root_id, &name, &root)?;

    if rewrites.is_empty() {
        repo.add_media_root(&root_id, &name)?;
        state
            .device_storage
            .set_root_grant(&library_id, &root_id, &root, bookmark.as_deref())?;
    } else {
        repo.consolidate_media_roots(&root_id, &name, &rewrites)?;
        let old_ids: Vec<String> = rewrites.iter().map(|(id, _)| id.clone()).collect();
        state.device_storage.consolidate_roots(
            &library_id,
            &old_ids,
            &root_id,
            &root,
            bookmark.as_deref(),
        )?;
    }
    crate::library::rehydrate_media_roots(repo.as_ref(), state);
    Ok(folder)
}

fn portable_relative(path: &Path) -> Result<String, String> {
    path.components()
        .map(|component| {
            component
                .as_os_str()
                .to_str()
                .map(str::to_string)
                .ok_or_else(|| "folder path is not valid UTF-8".to_string())
        })
        .collect::<Result<Vec<_>, _>>()
        .map(|parts| parts.join("/"))
}

/// Reconnect a root from a library created on another device.
#[tauri::command]
pub fn bind_media_root(
    app: AppHandle,
    root_id: String,
    path: String,
    bookmark: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<Folder>, String> {
    let (path, bookmark) = prepare_selected_folder(&app, path, bookmark)?;
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

    // If the user chooses a parent containing this unavailable root, treat it
    // as a parent import. This reconnects and consolidates all direct child
    // roots in one Files-picker operation on iPad.
    let selected_name = root_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if selected_name != media_root.name && root_path.join(&media_root.name).is_dir() {
        import_folder_inner(root_path.to_string_lossy().into_owned(), bookmark, &state)?;
        return list_imported_folders(state);
    }
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
    state.device_storage.set_root_grant(
        &library_id,
        &media_root.id,
        &root_path,
        bookmark.as_deref(),
    )?;
    state
        .catalog
        .lock()
        .map_err(|error| error.to_string())?
        .rehydrate_root(&media_root.id, &media_root.name, &root_path)
        .map_err(|error| {
            format!(
                "Folder access was granted, but the complete network folder could not be scanned. Open the folder in Files and try Reconnect again: {error}"
            )
        })?;
    list_imported_folders(state)
}

#[cfg(target_os = "ios")]
fn prepare_selected_folder(
    app: &AppHandle,
    _path: String,
    bookmark: Option<String>,
) -> Result<(String, Option<String>), String> {
    let bookmark = bookmark.ok_or_else(|| {
        "The iPad did not receive permission for this folder. Choose it again in Files.".to_string()
    })?;
    let prepared = tauri_plugin_folder_access::prepare_folder(app, &bookmark)?;
    // Use the bookmark-resolved path rather than the picker path. File
    // Providers can remount a network share at a new transient location.
    Ok((prepared.path, Some(prepared.bookmark)))
}

#[cfg(not(target_os = "ios"))]
fn prepare_selected_folder(
    _app: &AppHandle,
    path: String,
    bookmark: Option<String>,
) -> Result<(String, Option<String>), String> {
    Ok((path, bookmark))
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

/// Re-scan one root or nested folder without walking unrelated imports.
#[tauri::command]
pub fn refresh_folder(
    folder_path: String,
    state: State<'_, AppState>,
) -> Result<Vec<Folder>, String> {
    let (root_id, _) = crate::library::split_portable_key(&folder_path)?;
    let repo = state.repository()?;
    let library_id = repo.library_id()?;
    let root_path = state
        .device_storage
        .bindings_for(&library_id)
        .remove(root_id)
        .ok_or_else(|| "media root needs reconnecting on this device".to_string())?;
    let mut catalog = state.catalog.lock().map_err(|e| e.to_string())?;
    catalog.refresh_folder(&folder_path, &root_path)?;
    for key in catalog.photo_keys() {
        if !key.starts_with(root_id) {
            continue;
        }
        let source = state.resolve_library_path(&key)?;
        crate::sidecar::sync_photo_index(repo.as_ref(), &key, &source)?;
    }
    Ok(catalog.roots())
}

/// Remove a top-level imported folder from the library without deleting any
/// photos from disk.
#[tauri::command]
pub fn remove_imported_folder(
    root_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<Folder>, String> {
    let repo = state.repository()?;
    let library_id = repo.library_id()?;
    repo.remove_media_root(&root_id)?;
    state.device_storage.remove_root(&library_id, &root_id)?;
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

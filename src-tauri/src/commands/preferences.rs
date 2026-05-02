//! Tauri commands for persisted UI preferences:
//!   - per-photo (format, variant) selection (`photo_variants` table)
//!   - "last selected folder" so the app reopens the previous folder on launch
//!     (stored in `app_settings` under the `last_folder` key)

use serde::Serialize;
use tauri::State;

use crate::app_state::AppState;

const LAST_FOLDER_KEY: &str = "last_folder";

#[derive(Debug, Clone, Serialize)]
pub struct PhotoVariantPref {
    pub path: String,
    pub format: String,
    pub variant: String,
}

#[tauri::command]
pub fn get_photo_variants(
    state: State<'_, AppState>,
) -> Result<Vec<PhotoVariantPref>, String> {
    let repo = state.repository()?;
    let rows = repo.all_photo_variants()?;
    Ok(rows
        .into_iter()
        .map(|(path, format, variant)| PhotoVariantPref {
            path,
            format,
            variant,
        })
        .collect())
}

#[tauri::command]
pub fn set_photo_variant(
    path: String,
    format: String,
    variant: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let repo = state.repository()?;
    repo.set_photo_variant(&path, &format, &variant)
}

#[tauri::command]
pub fn get_last_folder(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let repo = state.repository()?;
    repo.get_setting(LAST_FOLDER_KEY)
}

#[tauri::command]
pub fn set_last_folder(
    path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let repo = state.repository()?;
    repo.set_setting(LAST_FOLDER_KEY, &path)
}

//! Tauri commands for persisted UI preferences:
//!   - per-photo (format, variant) selection (`photo_variants` table)
//!   - "last selected folder" so the app reopens the previous folder on launch
//!     (stored in `app_settings` under the `last_folder` key)
//!   - full-view UI state (background swatch + fit mode + sizing) in
//!     `app_settings` under the `view_state` key, stored as JSON.
//!   - last opened photo + view (grid vs full) under the `app_view` key,
//!     so the app re-opens whatever was on screen last session.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::app_state::AppState;

const LAST_FOLDER_KEY: &str = "last_folder";
const VIEW_STATE_KEY: &str = "view_state";
const APP_VIEW_KEY: &str = "app_view";
const POST_PROCESS_PRESETS_KEY: &str = "post_process_presets_v1";
const PHOTO_EFFECTS_KEY: &str = "photo_effects_v1";

#[tauri::command]
pub fn get_post_process_presets(state: State<'_, AppState>) -> Result<Option<String>, String> {
    state.repository()?.get_setting(POST_PROCESS_PRESETS_KEY)
}

#[tauri::command]
pub fn set_post_process_presets(
    presets_json: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Reject malformed data before putting it into a library file. The
    // frontend owns the schema and handles forward-compatible defaults.
    serde_json::from_str::<serde_json::Value>(&presets_json).map_err(|e| e.to_string())?;
    state
        .repository()?
        .set_setting(POST_PROCESS_PRESETS_KEY, &presets_json)
}

#[tauri::command]
pub fn get_photo_effects(state: State<'_, AppState>) -> Result<Option<String>, String> {
    state.repository()?.get_setting(PHOTO_EFFECTS_KEY)
}

#[tauri::command]
pub fn set_photo_effects(effects_json: String, state: State<'_, AppState>) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&effects_json).map_err(|e| e.to_string())?;
    state
        .repository()?
        .set_setting(PHOTO_EFFECTS_KEY, &effects_json)
}

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

/// Persisted full-view UI state. Optional fields so the frontend can
/// extend it later without a schema bump (rows missing fields fall
/// back to defaults on the JS side).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ViewState {
    pub bg: Option<String>,
    pub fit: Option<String>,
    #[serde(default)]
    pub sizing: Option<String>,
    #[serde(default)]
    pub smoothing: Option<String>,
}

#[tauri::command]
pub fn get_view_state(state: State<'_, AppState>) -> Result<Option<ViewState>, String> {
    let repo = state.repository()?;
    let raw = repo.get_setting(VIEW_STATE_KEY)?;
    let Some(raw) = raw else {
        return Ok(None);
    };
    serde_json::from_str::<ViewState>(&raw)
        .map(Some)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_view_state(
    view: ViewState,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let repo = state.repository()?;
    let json = serde_json::to_string(&view).map_err(|e| e.to_string())?;
    repo.set_setting(VIEW_STATE_KEY, &json)
}

/// Last opened photo + which surface (grid or full) the user was on.
/// Both fields optional so the frontend can clear either independently.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppView {
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub view: Option<String>,
    /// Whether the folder sidebar is collapsed.
    #[serde(default)]
    pub sidebar_collapsed: Option<bool>,
    /// Whether the right-side edit panel is expanded in windowed mode.
    #[serde(default)]
    pub edit_panel_open: Option<bool>,
    /// Whether photo listings should include all subfolders of the
    /// selected folder.
    #[serde(default)]
    pub include_subfolders: Option<bool>,
}

#[tauri::command]
pub fn get_app_view(state: State<'_, AppState>) -> Result<Option<AppView>, String> {
    let repo = state.repository()?;
    let raw = repo.get_setting(APP_VIEW_KEY)?;
    let Some(raw) = raw else {
        return Ok(None);
    };
    serde_json::from_str::<AppView>(&raw)
        .map(Some)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_app_view(
    view: AppView,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let repo = state.repository()?;
    let json = serde_json::to_string(&view).map_err(|e| e.to_string())?;
    repo.set_setting(APP_VIEW_KEY, &json)
}

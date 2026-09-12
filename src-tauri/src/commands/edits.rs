//! Tauri commands for non-destructive photo edits.
//!
//! Edits are persisted in an adjacent Warble JSON sidecar and indexed in the
//! SQLite `photo_edits` table. They are applied on the fly when the frontend
//! requests a full-resolution image; the original image is never modified.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::app_state::AppState;
use crate::imaging::edits::{CropEdit, PhotoEdits, ToneEdit};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoEditDto {
    pub path: String,
    #[serde(default)]
    pub crop: Option<CropEdit>,
    #[serde(default)]
    pub tone: Option<ToneEdit>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub curve: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<serde_json::Value>,
}

#[tauri::command]
pub fn get_photo_edits(state: State<'_, AppState>) -> Result<Vec<PhotoEditDto>, String> {
    let repo = state.repository()?;
    let rows = repo.all_photo_edits()?;
    let mut out = Vec::with_capacity(rows.len());
    for (path, json) in rows {
        let edits: PhotoEdits = serde_json::from_str(&json).map_err(|e| e.to_string())?;
        out.push(PhotoEditDto {
            path,
            crop: edits.crop,
            tone: edits.tone,
            curve: edits.curve,
            color: edits.color,
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn set_photo_edit(
    path: String,
    crop: Option<CropEdit>,
    tone: Option<ToneEdit>,
    curve: Option<serde_json::Value>,
    color: Option<serde_json::Value>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let repo = state.repository()?;
    let edits = PhotoEdits {
        crop,
        tone,
        curve,
        color,
    };
    let source = state.resolve_library_path(&path)?;
    crate::sidecar::write_edits(&source, &edits)?;
    if edits.is_empty() {
        repo.delete_photo_edit(&path)
    } else {
        let json = serde_json::to_string(&edits).map_err(|e| e.to_string())?;
        repo.set_photo_edit(&path, &json)
    }
}

#[tauri::command]
pub fn clear_photo_edit(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let repo = state.repository()?;
    let source = state.resolve_library_path(&path)?;
    crate::sidecar::write_edits(&source, &PhotoEdits::default())?;
    repo.delete_photo_edit(&path)
}

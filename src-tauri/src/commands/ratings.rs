//! Tauri commands for per-photo star ratings (0..=5) and color
//! labels. They are mirrored to an adjacent XMP sidecar and indexed in the
//! device-local SQLite `photo_ratings` table; the original image is unchanged.

use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::app_state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoRatingDto {
    pub path: String,
    pub rating: i64,
    pub label: String,
    /// Unix epoch seconds at which the rating was last set. `0` for
    /// rows that pre-date the timestamp column.
    pub rated_at: i64,
}

#[tauri::command]
pub fn get_photo_ratings(state: State<'_, AppState>) -> Result<Vec<PhotoRatingDto>, String> {
    let repo = state.repository()?;
    let rows = repo.all_photo_ratings()?;
    Ok(rows
        .into_iter()
        .map(|(path, rating, label, rated_at)| PhotoRatingDto {
            path,
            rating,
            label,
            rated_at,
        })
        .collect())
}

#[tauri::command]
pub fn set_photo_rating(
    path: String,
    rating: i64,
    label: String,
    state: State<'_, AppState>,
) -> Result<i64, String> {
    let repo = state.repository()?;
    let source = state.resolve_library_path(&path)?;
    let rating = rating.clamp(0, 5);
    let label = sanitize_label(&label);
    let rated_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    crate::sidecar::write_rating(&repo, &path, &source, rating, &label, rated_at)?;
    Ok(if rating == 0 && label.is_empty() {
        0
    } else {
        rated_at
    })
}

fn sanitize_label(label: &str) -> String {
    match label {
        "green" | "blue" | "yellow" | "red" => label.to_string(),
        _ => String::new(),
    }
}

//! Tauri commands for image rendering: thumbnails and full-resolution
//! bytes for the canvas viewer.
//!
//! Non-destructive edits (crop, etc.) are intentionally NOT applied
//! here. The frontend canvas applies them at render time on the
//! decoded `ImageBitmap`, which is format-agnostic and free — no
//! decode/re-encode round trip per save. The backend's only job is
//! to hand the canvas encoded image bytes (or the embedded preview).
//!
//! Image reads use a small worker queue. The active photo is urgent;
//! visible thumbnails use normal priority; bulk filter metadata runs behind
//! interactive image work. The frontend
//! can cancel stale image requests during rapid navigation.

use serde::Serialize;
use tauri::ipc::Response;
use tauri::State;

use crate::app_state::AppState;
use crate::imaging::{exif_cache, full_image, hd_image, thumbnails};
use crate::sidecar::MetadataOverrides;
use crate::tasks::{self, Priority};

#[tauri::command]
pub async fn get_thumbnail(
    photo_path: String,
    request_id: Option<u64>,
    urgent: Option<bool>,
    background: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Response, String> {
    let resolved = state.resolve_library_path(&photo_path)?;
    let resolved = resolved.to_string_lossy().into_owned();
    let priority = if urgent.unwrap_or(false) {
        Priority::Urgent
    } else if background.unwrap_or(false) {
        Priority::Background
    } else {
        Priority::Normal
    };
    let bytes = tasks::run(priority, request_id, move |cancel| {
        thumbnails::render(&resolved, &photo_path, cancel)
    })
    .await?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub async fn get_full_image_bytes(
    photo_path: String,
    request_id: Option<u64>,
    state: State<'_, AppState>,
) -> Result<Response, String> {
    let resolved = state.resolve_library_path(&photo_path)?;
    let resolved = resolved.to_string_lossy().into_owned();
    let bytes = tasks::run(Priority::Urgent, request_id, move |cancel| {
        full_image::load_bytes(&resolved, cancel)
    })
    .await?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub async fn get_hd_image_bytes(
    photo_path: String,
    request_id: Option<u64>,
    state: State<'_, AppState>,
) -> Result<Response, String> {
    let resolved = state.resolve_library_path(&photo_path)?;
    let resolved = resolved.to_string_lossy().into_owned();
    let bytes = tasks::run(Priority::Urgent, request_id, move |cancel| {
        hd_image::load_bytes(&resolved, &photo_path, cancel)
    })
    .await?;
    Ok(Response::new(bytes))
}

/// Cancel a previously submitted image request by id. Idempotent —
/// unknown ids are remembered briefly so a cancel-before-submit race
/// still wins.
#[tauri::command]
pub fn cancel_image_request(request_id: u64) {
    tasks::pool().cancel(request_id);
}

/// Raise a queued background request when it becomes visible or urgent.
#[tauri::command]
pub fn promote_image_request(request_id: u64, urgent: bool) {
    let priority = if urgent {
        Priority::Urgent
    } else {
        Priority::Normal
    };
    tasks::pool().promote(request_id, priority);
}

/// Read EXIF metadata for the photo at `photo_path`. Returns an
/// `ExifMetadata` with `null` for any tags that aren't present so the
/// frontend can decide whether to render each row.
///
/// Backed by a SQLite cache (`photo_exif`): the file is only opened
/// and parsed on first request, or after the file's mtime/size
/// changes. Subsequent panel opens are a single indexed row read.
#[tauri::command]
pub async fn get_exif_metadata(
    photo_path: String,
    request_id: Option<u64>,
    state: State<'_, AppState>,
) -> Result<crate::imaging::exif::ExifMetadata, String> {
    let resolved = state.resolve_library_path(&photo_path)?;
    tasks::run(Priority::Urgent, request_id, move |cancel| {
        cancel.check()?;
        Ok::<_, String>(exif_cache::get_or_compute(&photo_path, &resolved))
    })
    .await
}

#[tauri::command]
pub async fn set_photo_metadata(
    photo_paths: Vec<String>,
    changes: MetadataOverrides,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if let Some(date) = &changes.date_taken {
        if !date.is_empty() && !valid_capture_date(date) {
            return Err("Capture date must be a valid YYYY-MM-DD or YYYY-MM-DD HH:MM:SS".into());
        }
    }
    let mut photos = Vec::with_capacity(photo_paths.len());
    for key in photo_paths {
        photos.push((key.clone(), state.resolve_library_path(&key)?));
    }
    tasks::run(Priority::Urgent, None, move |cancel| {
        for (key, source) in photos {
            cancel.check()?;
            exif_cache::update_metadata(&key, &source, &changes)?;
        }
        Ok(())
    }).await
}

fn valid_capture_date(value: &str) -> bool {
    let (day, time) = value.split_once(' ').unwrap_or((value, ""));
    if day.len() != 10 || normalize_date(day).as_deref() != Some(day) {
        return false;
    }
    let year = day[..4].parse::<i32>().unwrap_or(0);
    let month = day[5..7].parse::<u32>().unwrap_or(0);
    let date = day[8..10].parse::<u32>().unwrap_or(0);
    if year < 1 || ![31, if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        .get(month.saturating_sub(1) as usize).is_some_and(|days| date >= 1 && date <= *days) {
        return false;
    }
    time.is_empty() || (time.len() == 8 && time.as_bytes()[2] == b':' && time.as_bytes()[5] == b':'
        && time[..2].parse::<u32>().is_ok_and(|n| n < 24)
        && time[3..5].parse::<u32>().is_ok_and(|n| n < 60)
        && time[6..].parse::<u32>().is_ok_and(|n| n < 60))
}

/// Small EXIF projection used by the grid filters. The full metadata record
/// is still what gets cached in the library; this command avoids sending the
/// much larger info-panel payload for every photo in a folder.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoFilterInfo {
    pub path: String,
    pub camera: Option<String>,
    pub lens: Option<String>,
    pub focal_length_mm: Option<f64>,
    pub date_taken: Option<String>,
}

fn filter_info(path: String, metadata: &crate::imaging::exif::ExifMetadata) -> PhotoFilterInfo {
    let camera = metadata
        .camera_model
        .clone()
        .or_else(|| metadata.camera_make.clone());
    let lens = metadata
        .lens_model
        .clone()
        .or_else(|| metadata.lens_make.clone());
    let focal_length_mm = metadata.focal_length_mm.or_else(|| {
        metadata
            .focal_length
            .as_deref()
            .and_then(parse_focal_length_mm)
    });
    let date_taken = metadata.date_taken.as_deref().and_then(normalize_date);
    PhotoFilterInfo {
        path,
        camera,
        lens,
        focal_length_mm,
        date_taken,
    }
}

/// Read only existing fingerprint-valid EXIF cache entries. Never parse source
/// photos here; the usual background metadata pipeline fills cache misses.
#[tauri::command]
pub async fn get_cached_photo_filter_metadata(
    photo_paths: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<PhotoFilterInfo>, String> {
    let mut requests = Vec::with_capacity(photo_paths.len());
    for key in photo_paths {
        if let Ok(resolved) = state.resolve_library_path(&key) {
            requests.push((key, resolved));
        }
    }

    tasks::run(Priority::Background, None, move |cancel| {
        let mut result = Vec::new();
        for (path, resolved) in requests {
            cancel.check()?;
            if let Some((_, metadata)) = exif_cache::get(&path, &resolved) {
                result.push(filter_info(path, &metadata));
            }
        }
        Ok(result)
    })
    .await
}

/// Read filter metadata for a requested batch. Each item is served by the
/// same fingerprinted EXIF cache used by image rendering and the detail panel.
#[tauri::command]
pub async fn get_photo_filter_metadata(
    photo_paths: Vec<String>,
    request_id: Option<u64>,
    state: State<'_, AppState>,
) -> Result<Vec<PhotoFilterInfo>, String> {
    let mut requests = Vec::with_capacity(photo_paths.len());
    for key in photo_paths {
        let resolved = state.resolve_library_path(&key)?;
        requests.push((key, resolved));
    }

    tasks::run(Priority::Background, request_id, move |cancel| {
        let mut result = Vec::with_capacity(requests.len());
        for (path, resolved) in requests {
            cancel.check()?;
            let metadata = exif_cache::get_or_compute(&path, &resolved);
            result.push(filter_info(path, &metadata));
        }
        Ok(result)
    })
    .await
}

fn parse_focal_length_mm(value: &str) -> Option<f64> {
    value
        .trim()
        .trim_end_matches("mm")
        .trim()
        .parse::<f64>()
        .ok()
}

/// Convert the common EXIF `YYYY:MM:DD HH:MM:SS` form (and ISO-like
/// variants) into a sortable, date-input-compatible day string.
fn normalize_date(value: &str) -> Option<String> {
    let day = value.trim().split([' ', 'T']).next()?.trim();
    let normalized = if day.len() >= 10 && day.as_bytes().get(4) == Some(&b':') {
        format!("{}-{}-{}", &day[0..4], &day[5..7], &day[8..10])
    } else {
        day.get(..10)?.to_string()
    };
    let bytes = normalized.as_bytes();
    if normalized.len() == 10
        && bytes.get(4) == Some(&b'-')
        && bytes.get(7) == Some(&b'-')
        && normalized[..4].parse::<u16>().is_ok()
        && normalized[5..7]
            .parse::<u8>()
            .ok()
            .is_some_and(|month| (1..=12).contains(&month))
        && normalized[8..10]
            .parse::<u8>()
            .ok()
            .is_some_and(|day| (1..=31).contains(&day))
    {
        Some(normalized)
    } else {
        None
    }
}

//! Tauri commands for image rendering: thumbnails and full-resolution
//! bytes for the canvas viewer.
//!
//! Non-destructive edits (crop, etc.) are intentionally NOT applied
//! here. The frontend canvas applies them at render time on the
//! decoded `ImageBitmap`, which is format-agnostic and free — no
//! decode/re-encode round trip per save. The backend's only job is
//! to hand the canvas the original decoded bytes (or, for RAW, the
//! developed preview bytes).
//!
//! Image reads use a small worker queue. The active photo is urgent;
//! visible thumbnails and filter metadata use normal priority. The frontend
//! can cancel stale image requests during rapid navigation.

use serde::Serialize;
use tauri::ipc::Response;
use tauri::State;

use crate::app_state::AppState;
use crate::imaging::{exif_cache, full_image, hd_image, raw_preview, thumbnails};
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

/// Return a linear, demosaiced RGB16 working image for RAW editing. The
/// frontend uploads this directly as a high-bit-depth WebGL texture instead
/// of decoding a JPEG and losing the RAW headroom before the first slider.
#[tauri::command]
pub async fn get_raw_image_bytes(
    photo_path: String,
    request_id: Option<u64>,
    max_long_side: Option<u32>,
    state: State<'_, AppState>,
) -> Result<Response, String> {
    let resolved = state.resolve_library_path(&photo_path)?;
    let resolved = resolved.to_string_lossy().into_owned();
    let bytes = tasks::run(Priority::Urgent, request_id, move |cancel| {
        let limit = max_long_side
            .filter(|value| *value > 0)
            .map(|value| value as usize);
        let image = raw_preview::decode_linear16(std::path::Path::new(&resolved), limit, cancel)?;
        raw_preview::encode_linear16(&image)
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

    tasks::run(Priority::Normal, request_id, move |cancel| {
        let mut result = Vec::with_capacity(requests.len());
        for (path, resolved) in requests {
            cancel.check()?;
            let metadata = exif_cache::get_or_compute(&path, &resolved);
            let camera = metadata
                .camera_model
                .clone()
                .or_else(|| metadata.camera_make.clone());
            let lens = metadata
                .lens_model
                .clone()
                .or_else(|| metadata.lens_make.clone());
            // Older cache rows predate the numeric field. Recover their
            // value from the existing display string without forcing a
            // second source-file parse.
            let focal_length_mm = metadata.focal_length_mm.or_else(|| {
                metadata
                    .focal_length
                    .as_deref()
                    .and_then(parse_focal_length_mm)
            });
            let date_taken = metadata.date_taken.as_deref().and_then(normalize_date);
            result.push(PhotoFilterInfo {
                path,
                camera,
                lens,
                focal_length_mm,
                date_taken,
            });
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

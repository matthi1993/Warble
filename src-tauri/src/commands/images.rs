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
//! ## Priority + cancellation
//!
//! All image work is dispatched through [`crate::tasks`], a two-tier
//! priority pool:
//!
//! * `urgent` / `foreground` jobs land on a dedicated foreground pool
//!   reserved for the photo the user is actively viewing and the
//!   thumbnails currently on screen.
//! * `background` jobs (folder-wide thumbnail batches, neighbour
//!   prefetches) run on a separate pool so they cannot block a
//!   foreground decode.
//!
//! The frontend supplies an optional `request_id`; calling
//! [`cancel_image_request`] with that id flips a cooperative cancel
//! flag. Jobs that haven't yet started skip their work entirely;
//! running jobs poll the flag at every step they can and bail out
//! with `Err("cancelled")` so the worker is freed for the next
//! request — essential for the hot navigation case where the user
//! flicks past a still-decoding photo.

use tauri::ipc::Response;
use tauri::State;

use crate::app_state::AppState;
use crate::imaging::{exif_cache, full_image, hd_image, raw_preview, thumbnails};
use crate::tasks::{self, Priority};

#[tauri::command]
pub async fn get_thumbnail(
    photo_path: String,
    request_id: Option<u64>,
    priority: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let resolved = state.resolve_library_path(&photo_path)?;
    let resolved = resolved.to_string_lossy().into_owned();
    // Thumbnails default to background — folder batches and offscreen
    // cards both come through here, and the only call sites that
    // matter for latency (active photo's preview thumbnail and
    // visible thumbnail cards) explicitly upgrade priority.
    let prio = match priority.as_deref() {
        Some(s) => Priority::parse(Some(s)),
        None => Priority::Background,
    };
    tasks::run(prio, request_id, "thumbnail", move |cancel| {
        thumbnails::render(&resolved, &photo_path, cancel)
    })
    .await
}

#[tauri::command]
pub async fn get_full_image_bytes(
    photo_path: String,
    request_id: Option<u64>,
    priority: Option<String>,
    state: State<'_, AppState>,
) -> Result<Response, String> {
    let resolved = state.resolve_library_path(&photo_path)?;
    let resolved = resolved.to_string_lossy().into_owned();
    // Default to urgent: the only consumer is the active canvas, and
    // prefetch explicitly downgrades to `background`.
    let prio = match priority.as_deref() {
        Some(s) => Priority::parse(Some(s)),
        None => Priority::Urgent,
    };
    let bytes = tasks::run(prio, request_id, "full_image", move |cancel| {
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
    priority: Option<String>,
    max_long_side: Option<u32>,
    state: State<'_, AppState>,
) -> Result<Response, String> {
    let resolved = state.resolve_library_path(&photo_path)?;
    let resolved = resolved.to_string_lossy().into_owned();
    let prio = match priority.as_deref() {
        Some(s) => Priority::parse(Some(s)),
        None => Priority::Urgent,
    };
    let bytes = tasks::run(prio, request_id, "raw_image", move |cancel| {
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
    priority: Option<String>,
    state: State<'_, AppState>,
) -> Result<Response, String> {
    let resolved = state.resolve_library_path(&photo_path)?;
    let resolved = resolved.to_string_lossy().into_owned();
    // Default to urgent: the only consumer is the active canvas, and
    // prefetch explicitly downgrades to `background`.
    let prio = match priority.as_deref() {
        Some(s) => Priority::parse(Some(s)),
        None => Priority::Urgent,
    };
    let bytes = tasks::run(prio, request_id, "hd_image", move |cancel| {
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
    state: State<'_, AppState>,
) -> Result<crate::imaging::exif::ExifMetadata, String> {
    let resolved = state.resolve_library_path(&photo_path)?;
    // EXIF reads are short and only fired for the active photo, so
    // run them on the foreground pool.
    tasks::run(Priority::Foreground, None, "exif", move |_cancel| {
        Ok::<_, String>(exif_cache::get_or_compute(&photo_path, &resolved))
    })
    .await
}

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
//! flag so a job that hasn't yet started skips its work entirely. A
//! job already running runs to completion — the long phase (image
//! decode) lives inside `image` / `jpeg-decoder` which we can't
//! preempt — but its result will simply be discarded by the caller.

use std::path::PathBuf;

use tauri::ipc::Response;

use crate::imaging::{exif, full_image, thumbnails};
use crate::tasks::{self, Priority};

#[tauri::command]
pub async fn get_thumbnail(
    photo_path: String,
    request_id: Option<u64>,
    priority: Option<String>,
) -> Result<String, String> {
    // Thumbnails default to background — folder batches and offscreen
    // cards both come through here, and the only call sites that
    // matter for latency (active photo's preview thumbnail and
    // visible thumbnail cards) explicitly upgrade priority.
    let prio = match priority.as_deref() {
        Some(s) => Priority::parse(Some(s)),
        None => Priority::Background,
    };
    tasks::run(prio, request_id, move |_cancel| {
        thumbnails::render(&photo_path)
    })
    .await
}

#[tauri::command]
pub async fn get_full_image_bytes(
    photo_path: String,
    request_id: Option<u64>,
    priority: Option<String>,
) -> Result<Response, String> {
    // Default to urgent: the only consumer is the active canvas, and
    // prefetch explicitly downgrades to `background`.
    let prio = match priority.as_deref() {
        Some(s) => Priority::parse(Some(s)),
        None => Priority::Urgent,
    };
    let bytes = tasks::run(prio, request_id, move |_cancel| {
        full_image::load_bytes(&photo_path)
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
#[tauri::command]
pub async fn get_exif_metadata(
    photo_path: String,
) -> Result<exif::ExifMetadata, String> {
    // EXIF reads are short and only fired for the active photo, so
    // run them on the foreground pool.
    tasks::run(Priority::Foreground, None, move |_cancel| {
        Ok::<_, String>(exif::read_metadata(&PathBuf::from(photo_path)))
    })
    .await
}

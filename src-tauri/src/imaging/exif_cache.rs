//! DB-backed cache for parsed EXIF metadata.
//!
//! Reading EXIF from disk is cheap individually, but the detail panel,
//! HD image renderer, and full-image renderer all reach for it on
//! every photo open. This module persists the parsed
//! [`super::exif::ExifMetadata`] in the SQLite library DB (table
//! `photo_exif`), keyed by the source file's `(mtime, size)` so any
//! external edit invalidates the row automatically.

use std::path::Path;
use std::sync::{Arc, OnceLock};
use std::time::UNIX_EPOCH;

use super::exif::{self, ExifMetadata, IDENTITY};
use crate::library::LibraryRepository;

static REPO: OnceLock<Arc<LibraryRepository>> = OnceLock::new();

/// Wire up the cache. Subsequent calls are ignored.
pub fn init(repo: Arc<LibraryRepository>) {
    let _ = REPO.set(repo);
}

/// Return cached `(orientation, metadata)` for `path` if the row's
/// fingerprint still matches the file on disk.
pub fn get(path: &Path) -> Option<(u32, ExifMetadata)> {
    let repo = REPO.get()?;
    let key = path.to_str()?;
    let (mtime, size) = file_fingerprint(path)?;
    let (cached_mtime, cached_size, orientation, metadata_json) =
        repo.get_photo_exif(key).ok().flatten()?;
    if cached_mtime != mtime || cached_size != size {
        return None;
    }
    let metadata = serde_json::from_str::<ExifMetadata>(&metadata_json).ok()?;
    Some((orientation, metadata))
}

/// Get cached metadata, computing + persisting it on miss. The
/// returned struct matches [`exif::read_metadata`] semantics: empty
/// fields when EXIF is absent or unreadable.
pub fn get_or_compute(path: &Path) -> ExifMetadata {
    if let Some((_, metadata)) = get(path) {
        return metadata;
    }
    match exif::read_full_metadata(path) {
        Some((orientation, metadata)) => {
            store(path, orientation, &metadata);
            metadata
        }
        None => ExifMetadata::default(),
    }
}

/// Cached orientation, falling back to parsing the in-memory `bytes`.
/// On a miss this also opportunistically warms the full metadata
/// cache from those same bytes — every imaging pipeline already has
/// the source bytes in memory at this point, so populating EXIF is
/// effectively free.
pub fn orientation_or_warm(path: &Path, bytes: &[u8]) -> u32 {
    if let Some((orient, _)) = get(path) {
        return orient;
    }
    match exif::read_full_metadata_from_bytes(bytes) {
        Some((orient, metadata)) => {
            store(path, orient, &metadata);
            orient
        }
        None => IDENTITY,
    }
}

/// Variant for callers that already parsed EXIF themselves (e.g. the
/// RAW preview pipeline) and just want to populate the cache.
pub fn warm_with(path: &Path, orientation: u32, metadata: &ExifMetadata) {
    store(path, orientation, metadata);
}

fn store(path: &Path, orientation: u32, metadata: &ExifMetadata) {
    let Some(repo) = REPO.get() else { return };
    let Some(key) = path.to_str() else { return };
    let Some((mtime, size)) = file_fingerprint(path) else {
        return;
    };
    let Ok(json) = serde_json::to_string(metadata) else {
        return;
    };
    let orient = if (1..=8).contains(&orientation) {
        orientation
    } else {
        IDENTITY
    };
    let _ = repo.set_photo_exif(key, mtime, size, orient, &json);
}

fn file_fingerprint(path: &Path) -> Option<(i64, i64)> {
    let meta = std::fs::metadata(path).ok()?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let size = meta.len() as i64;
    Some((mtime, size))
}

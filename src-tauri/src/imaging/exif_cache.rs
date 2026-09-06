//! DB-backed cache for parsed EXIF metadata.
//!
//! Reading EXIF from disk is cheap individually, but the detail panel,
//! HD image renderer, and full-image renderer all reach for it on
//! every photo open. This module persists the parsed
//! [`super::exif::ExifMetadata`] in the SQLite library DB (table
//! `photo_exif`), keyed by the source file's `(mtime, size)` so any
//! external edit invalidates the row automatically.

use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;
use std::time::UNIX_EPOCH;

use super::exif::{self, ExifMetadata, IDENTITY};
use crate::library::LibraryRepository;

static REPO: std::sync::OnceLock<std::sync::Mutex<Option<Arc<LibraryRepository>>>> =
    std::sync::OnceLock::new();
static IN_FLIGHT: std::sync::OnceLock<std::sync::Mutex<HashSet<String>>> =
    std::sync::OnceLock::new();

fn repo_slot() -> &'static std::sync::Mutex<Option<Arc<LibraryRepository>>> {
    REPO.get_or_init(|| std::sync::Mutex::new(None))
}

fn in_flight_slot() -> &'static std::sync::Mutex<HashSet<String>> {
    IN_FLIGHT.get_or_init(|| std::sync::Mutex::new(HashSet::new()))
}

/// Claim the first-touch parse for a photo. Thumbnail, HD, detail, and
/// filter requests can arrive together, so a persistent cache alone is not
/// enough to prevent duplicate parses on a cold row.
fn claim(key: &str, path: &Path) -> bool {
    loop {
        if get(key, path).is_some() {
            return false;
        }
        let Ok(mut guard) = in_flight_slot().lock() else {
            return true;
        };
        if guard.insert(key.to_string()) {
            return true;
        }
        drop(guard);
        std::thread::yield_now();
    }
}

fn release(key: &str) {
    if let Ok(mut guard) = in_flight_slot().lock() {
        guard.remove(key);
    }
}

/// Wire up the cache. Replaces any previous repository (used by
/// the library hot-swap flow).
pub fn init(repo: Arc<LibraryRepository>) {
    let slot = repo_slot();
    if let Ok(mut guard) = slot.lock() {
        *guard = Some(repo);
    }
}

/// Return cached `(orientation, metadata)` for `path` if the row's
/// fingerprint still matches the file on disk.
pub fn get(key: &str, path: &Path) -> Option<(u32, ExifMetadata)> {
    let repo = repo_slot().lock().ok()?.clone()?;
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
pub fn get_or_compute(key: &str, path: &Path) -> ExifMetadata {
    if let Some((_, metadata)) = get(key, path) {
        return metadata;
    }
    if !claim(key, path) {
        return get(key, path)
            .map(|(_, metadata)| metadata)
            .unwrap_or_default();
    }
    let result = match exif::read_full_metadata(path) {
        Some((orientation, metadata)) => {
            store(key, path, orientation, &metadata);
            metadata
        }
        None => {
            // Cache the negative result too. Otherwise screenshots and
            // images without EXIF are reparsed by every consumer.
            let metadata = ExifMetadata::default();
            store(key, path, IDENTITY, &metadata);
            metadata
        }
    };
    release(key);
    result
}

/// Cached orientation, falling back to parsing the in-memory `bytes`.
/// On a miss this also opportunistically warms the full metadata
/// cache from those same bytes — every imaging pipeline already has
/// the source bytes in memory at this point, so populating EXIF is
/// effectively free.
pub fn orientation_or_warm(key: &str, path: &Path, bytes: &[u8]) -> u32 {
    if let Some((orient, _)) = get(key, path) {
        return orient;
    }
    if !claim(key, path) {
        return get(key, path)
            .map(|(orientation, _)| orientation)
            .unwrap_or(IDENTITY);
    }
    let result = match exif::read_full_metadata_from_bytes(bytes) {
        Some((orient, metadata)) => {
            store(key, path, orient, &metadata);
            orient
        }
        None => {
            let metadata = ExifMetadata::default();
            store(key, path, IDENTITY, &metadata);
            IDENTITY
        }
    };
    release(key);
    result
}

/// Variant for callers that already parsed EXIF themselves (e.g. the
/// RAW preview pipeline) and just want to populate the cache.
pub fn warm_with(key: &str, path: &Path, orientation: u32, metadata: &ExifMetadata) {
    store(key, path, orientation, metadata);
}

fn store(key: &str, path: &Path, orientation: u32, metadata: &ExifMetadata) {
    let Some(repo) = (|| repo_slot().lock().ok()?.clone())() else {
        return;
    };
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

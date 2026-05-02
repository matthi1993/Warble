//! Full-resolution image loader for the canvas viewer.
//!
//! Returns *encoded* image bytes (JPEG/PNG) so the frontend can decode via
//! the browser's native, multi-threaded `createImageBitmap`. Avoids the
//! ~33 % base64 inflation and the ~96 MB RGBA round-trip per 24 MP image.
//!
//! * RAW files yield their largest embedded JPEG preview.
//! * TIFF is transcoded to JPEG once and cached.
//! * JPEG/PNG are passed through untouched.

mod transcode;

use std::fs;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

use super::raw_preview;
use crate::caching::MemoryLru;

pub fn load_bytes(path: &str) -> Result<Vec<u8>, String> {
    let p = Path::new(path);
    let mtime = fs::metadata(p)
        .and_then(|m| m.modified())
        .map_err(|e| e.to_string())?;
    if let Some(hit) = cache().lock().ok().and_then(|mut c| c.get(path, mtime)) {
        return Ok(hit);
    }

    let ext = lowercase_extension(p);
    let bytes = if raw_preview::is_raw_extension(&ext) {
        raw_preview::extract_preview(p)?.jpeg_bytes
    } else if matches!(ext.as_str(), "tif" | "tiff") {
        let raw = fs::read(p).map_err(|e| e.to_string())?;
        transcode::to_jpeg(&raw)?
    } else {
        fs::read(p).map_err(|e| e.to_string())?
    };

    if let Ok(mut c) = cache().lock() {
        c.insert(path.to_string(), mtime, bytes.clone());
    }
    Ok(bytes)
}

fn cache() -> &'static Mutex<MemoryLru<Vec<u8>>> {
    static CACHE: OnceLock<Mutex<MemoryLru<Vec<u8>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(MemoryLru::new(8)))
}

fn lowercase_extension(p: &Path) -> String {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default()
}

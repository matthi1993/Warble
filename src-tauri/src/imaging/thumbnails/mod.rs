//! Thumbnail rendering pipeline.
//!
//! 1. Look up an on-disk cached JPEG keyed by `(path, mtime, size)`.
//! 2. On miss, decode the source. JPEGs (and embedded RAW previews) take a
//!    fast DCT-scaled path; everything else falls back to `image`.
//! 3. Resize to the target width with `fast_image_resize` (SIMD).
//! 4. Re-encode JPEG, persist to the disk cache, return base64.

mod jpeg_fast_path;

use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use image::{ImageFormat, ImageReader};

use super::exif::{self, IDENTITY};
use super::raw_preview;
use super::resize::{downscale_dynamic_to_jpeg, downscale_rgb_to_jpeg};
use crate::caching::{CacheKeyBuilder, DiskCache};

const TARGET_WIDTH: u32 = 320;
const JPEG_QUALITY: u8 = 80;
/// Bumped when the pipeline changes in a way that invalidates existing
/// on-disk cache entries (e.g. EXIF-orientation rotation added).
const PIPELINE_VERSION: u32 = 2;

const JPEG_EXTENSIONS: &[&str] = &["jpg", "jpeg", "jpe", "jfif"];

static DISK_CACHE: OnceLock<DiskCache> = OnceLock::new();

/// Initialise the on-disk thumbnail cache directory. Safe to call multiple
/// times; only the first call wins.
pub fn init_cache_dir(dir: PathBuf) {
    let _ = DISK_CACHE.set(DiskCache::new(dir, "jpg"));
}

/// Update the maximum number of cached thumbnail files. `0` disables
/// eviction. Triggers an immediate sweep so the new limit is applied even
/// if no further thumbnails are written.
pub fn set_disk_cache_max_entries(max: usize) {
    if let Some(c) = DISK_CACHE.get() {
        c.set_max_entries(max);
    }
}

/// Drop every cached thumbnail file from disk.
pub fn clear_disk_cache() {
    if let Some(c) = DISK_CACHE.get() {
        c.clear();
    }
}

/// Generate a base64-encoded JPEG thumbnail for the given photo path.
pub fn render(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    let cache = DISK_CACHE.get();

    let cache_key = cache.map(|_| {
        CacheKeyBuilder::new()
            .with_source_file(p)
            .with(TARGET_WIDTH)
            .with(JPEG_QUALITY)
            .with(PIPELINE_VERSION)
            .build()
    });

    if let (Some(c), Some(k)) = (cache, cache_key) {
        if let Some(bytes) = c.get(&k) {
            return Ok(B64.encode(&bytes));
        }
    }

    let ext = lowercase_extension(p);
    let jpeg_bytes = if raw_preview::is_raw_extension(&ext) {
        render_from_raw(p)?
    } else if JPEG_EXTENSIONS.iter().any(|e| *e == ext) {
        render_from_jpeg_file(p)?
    } else {
        render_via_image_crate(p, IDENTITY)?
    };

    if let (Some(c), Some(k)) = (cache, cache_key) {
        c.put(&k, &jpeg_bytes);
    }
    Ok(B64.encode(&jpeg_bytes))
}

fn render_from_jpeg_file(path: &Path) -> Result<Vec<u8>, String> {
    let raw = fs::read(path).map_err(|e| e.to_string())?;
    let orient = exif::read_orientation(&raw);
    render_from_jpeg_bytes(&raw, orient).or_else(|_| render_via_image_crate(path, orient))
}

fn render_from_raw(path: &Path) -> Result<Vec<u8>, String> {
    let preview = raw_preview::extract_preview(path)?;

    if let Ok(out) = render_from_jpeg_bytes(&preview.jpeg_bytes, preview.orientation) {
        return Ok(out);
    }
    // Last-ditch: decode the preview fully via `image`, then resize.
    match ImageReader::with_format(Cursor::new(&preview.jpeg_bytes), ImageFormat::Jpeg).decode() {
        Ok(img) => downscale_dynamic_to_jpeg(
            exif::apply_to_dynamic(img, preview.orientation),
            TARGET_WIDTH,
            JPEG_QUALITY,
        ),
        Err(_) => Ok(preview.jpeg_bytes),
    }
}

fn render_from_jpeg_bytes(bytes: &[u8], orient: u32) -> Result<Vec<u8>, String> {
    let decoded = jpeg_fast_path::decode_jpeg_scaled(bytes, TARGET_WIDTH)?;
    let (rgb, w, h) = exif::apply_to_rgb8(decoded.pixels, decoded.width, decoded.height, orient);
    downscale_rgb_to_jpeg(&rgb, w, h, TARGET_WIDTH, JPEG_QUALITY)
}

fn render_via_image_crate(path: &Path, orient: u32) -> Result<Vec<u8>, String> {
    let img = ImageReader::open(path)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .decode()
        .map_err(|e| format!("Decode failed: {e}"))?;
    downscale_dynamic_to_jpeg(
        exif::apply_to_dynamic(img, orient),
        TARGET_WIDTH,
        JPEG_QUALITY,
    )
}

fn lowercase_extension(p: &Path) -> String {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default()
}

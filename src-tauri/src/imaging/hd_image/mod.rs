//! HD image loader: a 1920px-long-side, EXIF-oriented JPEG used by the
//! canvas viewer in place of the full-resolution image.
//!
//! Pipeline:
//!   1. Cache lookup (on-disk, keyed by source path + mtime + size).
//!   2. On miss: for JPEG sources (incl. embedded RAW previews) take
//!      the **fast DCT-scaled path** — `jpeg-decoder` decodes only
//!      every 2nd/4th/8th coefficient block, producing a
//!      pre-shrunken RGB8 buffer that is then SIMD-resized to the
//!      target. For PNG/TIFF/everything else, fall back to a full
//!      `image` decode.
//!   3. Apply EXIF orientation on the (now-small) buffer.
//!   4. SIMD downscale so the longest side is `LONG_SIDE_PX`,
//!      re-encode as JPEG, persist.
//!
//! Output is a baseline JPEG with no EXIF (orientation is already baked
//! into the pixels), so the frontend's `createImageBitmap` returns it
//! correctly oriented without any extra work.
//!
//! Pre-encoding to a smaller JPEG also keeps GPU memory bounded: the
//! decoded `ImageBitmap` is at most ~1920×1920 RGBA ≈ 14 MB instead of
//! the ~96 MB pinned by a 24 MP full-resolution bitmap.
//!
//! Skipping the full-resolution decode is the difference between a
//! ~30 s render of a 24 MP RAW preview and ~1–2 s on the same hardware.

use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use image::{ImageFormat, ImageReader};

use super::exif::{self, IDENTITY};
use super::exif_cache;
use super::jpeg_fast_path;
use super::raw_preview;
use super::resize::{downscale_dynamic_long_side_to_jpeg, downscale_rgb_to_jpeg};
use crate::caching::{CacheKeyBuilder, DiskCache};
use crate::tasks::CancelToken;

const LONG_SIDE_PX: u32 = 1920;
const JPEG_QUALITY: u8 = 90;
/// Bumped when the pipeline changes in a way that invalidates existing
/// on-disk cache entries.
///   v2: switched to DCT-scaled JPEG decode for JPEG / RAW-preview sources.
///   v3: RAW sources now go through `imagepipe` demosaic instead of the
///       embedded JPEG preview — cached v2 bytes for RAW paths still
///       contain the stale preview, so they must be evicted.
///   v4: RAW decoder switched to a `rawler` → `imagepipe` bridge so
///       modern bodies (e.g. Fujifilm X100VI / X-Trans) actually
///       decode; cached v3 bytes either don't exist (the v3 attempt
///       errored for unsupported cameras) or were produced by a
///       different color pipeline.
///   v5: Bridge now pulls the color matrix from rawler's
///       `color_matrix` HashMap (the deprecated `xyz_to_cam` field is
///       all zeros in 0.7.2), fixing all-black RAW output.
const PIPELINE_VERSION: u32 = 5;

static DISK_CACHE: OnceLock<DiskCache> = OnceLock::new();

/// Initialise the on-disk HD image cache directory. Safe to call
/// multiple times; only the first call wins.
pub fn init_cache_dir(dir: PathBuf) {
    let _ = DISK_CACHE.set(DiskCache::new(dir, "jpg"));
}

/// Update the maximum number of cached HD JPEG files. `0` disables and
/// clears the cache. Triggers an immediate sweep so the new limit is applied
/// even if no further entries are written.
pub fn set_disk_cache_max_entries(max: usize) {
    if let Some(c) = DISK_CACHE.get() {
        c.set_max_entries(max);
    }
}

/// Drop every cached HD JPEG file from disk.
pub fn clear_disk_cache() {
    if let Some(c) = DISK_CACHE.get() {
        c.clear();
    }
}

/// Filesystem path of the HD image cache directory, or `None` if the
/// cache hasn't been initialised yet.
pub fn cache_root_path() -> Option<PathBuf> {
    DISK_CACHE.get().map(|c| c.root().to_path_buf())
}

/// `(total_bytes, file_count)` for the on-disk HD image cache. `None`
/// if the cache hasn't been initialised yet.
pub fn cache_disk_usage() -> Option<(u64, usize)> {
    DISK_CACHE.get().map(|c| c.disk_usage())
}

const JPEG_EXTENSIONS: &[&str] = &["jpg", "jpeg", "jpe", "jfif"];

/// Load an HD JPEG (1920px long side) for the photo at `path`. Returns
/// the encoded JPEG bytes the frontend can hand to `createImageBitmap`.
///
/// `cancel` is polled cooperatively between major steps (file read,
/// decode, orientation transform, resize/encode) so a cancelled
/// request frees the worker thread promptly instead of running to
/// completion and discarding the result.
pub fn load_bytes(path: &str, library_key: &str, cancel: &CancelToken) -> Result<Vec<u8>, String> {
    let p = Path::new(path);
    let cache = DISK_CACHE.get();

    let cache_key = cache.map(|_| {
        CacheKeyBuilder::new()
            .with_source_file(p)
            .with(LONG_SIDE_PX)
            .with(JPEG_QUALITY)
            .with(PIPELINE_VERSION)
            .build()
    });

    if let (Some(c), Some(k)) = (cache, cache_key) {
        if let Some(bytes) = c.get(&k) {
            return Ok(bytes);
        }
    }

    cancel.check()?;
    let jpeg_bytes = render(p, library_key, cancel)?;

    if let (Some(c), Some(k)) = (cache, cache_key) {
        c.put(&k, &jpeg_bytes);
    }
    Ok(jpeg_bytes)
}

fn render(path: &Path, library_key: &str, cancel: &CancelToken) -> Result<Vec<u8>, String> {
    let ext = lowercase_extension(path);

    if raw_preview::is_raw_extension(&ext) {
        let preview = raw_preview::extract_preview_sized(path, Some(LONG_SIDE_PX as usize))?;
        cancel.check()?;
        // Embedded RAW previews are JPEG — same fast path applies.
        if let Ok(out) = render_jpeg_fast(&preview.jpeg_bytes, preview.orientation, cancel) {
            return Ok(out);
        }
        // Decoder rejected the format (rare CMYK previews, ...). Fall
        // back to a full decode.
        return render_jpeg_slow(&preview.jpeg_bytes, preview.orientation, cancel);
    }

    if JPEG_EXTENSIONS.iter().any(|e| *e == ext) {
        let raw = fs::read(path).map_err(|e| e.to_string())?;
        cancel.check()?;
        let orient = exif_cache::orientation_or_warm(library_key, path, &raw);
        return match render_jpeg_fast(&raw, orient, cancel) {
            Ok(out) => Ok(out),
            Err(_) => render_jpeg_slow(&raw, orient, cancel),
        };
    }

    // PNG / TIFF / WebP / ... — no DCT scaling available; full decode.
    let raw = fs::read(path).map_err(|e| e.to_string())?;
    cancel.check()?;
    let orient = exif_cache::orientation_or_warm(library_key, path, &raw);
    let img = ImageReader::new(Cursor::new(&raw))
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .decode()
        .map_err(|e| format!("Decode failed: {e}"))?;
    cancel.check()?;
    let oriented = if orient == IDENTITY {
        img
    } else {
        exif::apply_to_dynamic(img, orient)
    };
    cancel.check()?;
    downscale_dynamic_long_side_to_jpeg(oriented, LONG_SIDE_PX, JPEG_QUALITY)
}

/// Fast path: DCT-scaled JPEG decode + SIMD resize. Aims for a decoded
/// buffer ~2× the target long side so the SIMD resize still has good
/// quality input — `jpeg-decoder` rounds to the nearest 1/2/4/8 ratio.
fn render_jpeg_fast(bytes: &[u8], orient: u32, cancel: &CancelToken) -> Result<Vec<u8>, String> {
    // The fast-path helper takes a `min_width` and aims for ~2× that.
    // We need the *long side* of the (post-orientation) result to be
    // at least `LONG_SIDE_PX`, so for portrait sources we have to
    // bump `min_width` so height after scaling stays ≥ target.
    let info = jpeg_fast_path::peek_dimensions(bytes)?;
    let (src_w, src_h) = info;
    let post_rotate_long_is_height = matches!(orient, 5..=8) ^ (src_w >= src_h);
    let min_width = if post_rotate_long_is_height {
        // Long side of the rotated image is what was the height; pick
        // a min_width that scales the height to ≥ LONG_SIDE_PX.
        let target_h = LONG_SIDE_PX;
        let ratio = target_h as f32 / src_h as f32;
        ((src_w as f32 * ratio).ceil() as u32).max(1)
    } else {
        LONG_SIDE_PX
    };

    let decoded = jpeg_fast_path::decode_jpeg_scaled(bytes, min_width)?;
    cancel.check()?;
    let (rgb, w, h) = exif::apply_to_rgb8(decoded.pixels, decoded.width, decoded.height, orient);
    if rgb.is_empty() {
        return Err("empty buffer after orientation".to_string());
    }
    cancel.check()?;
    // Map "long side ≤ LONG_SIDE_PX" to a target_width for
    // `downscale_rgb_to_jpeg`.
    let target_width = if w >= h {
        LONG_SIDE_PX
    } else {
        let ratio = LONG_SIDE_PX as f32 / h as f32;
        ((w as f32 * ratio).round() as u32).max(1)
    };
    downscale_rgb_to_jpeg(&rgb, w, h, target_width, JPEG_QUALITY)
}

/// Slow path used when the fast path bails (unsupported pixel
/// format, header parse error, …). Decodes through `image`.
fn render_jpeg_slow(bytes: &[u8], orient: u32, cancel: &CancelToken) -> Result<Vec<u8>, String> {
    let img = ImageReader::with_format(Cursor::new(bytes), ImageFormat::Jpeg)
        .decode()
        .map_err(|e| format!("Decode failed: {e}"))?;
    cancel.check()?;
    let oriented = if orient == IDENTITY {
        img
    } else {
        exif::apply_to_dynamic(img, orient)
    };
    cancel.check()?;
    downscale_dynamic_long_side_to_jpeg(oriented, LONG_SIDE_PX, JPEG_QUALITY)
}

fn lowercase_extension(p: &Path) -> String {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default()
}

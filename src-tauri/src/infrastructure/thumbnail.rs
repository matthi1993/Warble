//! Thumbnail generation: returns a base64-encoded JPEG (~320 px wide).
//!
//! Pipeline:
//!   1. Look up an on-disk cached JPEG keyed by `(path, mtime, size)`.
//!   2. On miss, decode the source. For JPEG inputs (and embedded RAW
//!      previews) we use `jpeg-decoder` with DCT scaling, which downscales
//!      by powers of two during decode — typically 4-16× faster than a
//!      full decode. Other formats fall back to the `image` crate.
//!   3. Resize to the target width with `fast_image_resize` (SIMD).
//!   4. Re-encode JPEG q=80, write to the disk cache, return base64.

use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{Cursor, Write};
use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use exif::{In, Tag};
use fast_image_resize::images::Image as FirImage;
use fast_image_resize::{FilterType, PixelType, ResizeAlg, ResizeOptions, Resizer};
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, ImageFormat, ImageReader};

const TARGET_WIDTH: u32 = 320;
const JPEG_QUALITY: u8 = 80;
/// Bumped when the thumbnail pipeline changes in a way that invalidates
/// existing on-disk cache entries (e.g. EXIF-orientation rotation added).
const CACHE_VERSION: u32 = 2;

const RAW_EXTS: &[&str] = &[
    "raf", "raw", "arw", "cr2", "cr3", "nef", "dng", "orf", "rw2",
];

const JPEG_EXTS: &[&str] = &["jpg", "jpeg", "jpe", "jfif"];

static CACHE_DIR: OnceLock<Option<PathBuf>> = OnceLock::new();

/// Initialise the on-disk cache directory. Safe to call multiple times;
/// only the first call wins.
pub fn init_cache_dir(dir: PathBuf) {
    let _ = CACHE_DIR.set(Some(dir));
}

fn cache_dir() -> Option<&'static Path> {
    CACHE_DIR.get().and_then(|o| o.as_deref())
}

/// Generate a base64-encoded JPEG thumbnail for the given photo path.
pub fn generate_thumbnail(path: &str) -> Result<String, String> {
    let p = Path::new(path);

    // Disk cache lookup.
    let cache_path = cache_path_for(p);
    if let Some(ref cp) = cache_path {
        if let Ok(bytes) = fs::read(cp) {
            return Ok(B64.encode(&bytes));
        }
    }

    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();

    let jpeg_bytes = if RAW_EXTS.iter().any(|e| *e == ext) {
        thumbnail_from_raw(p)?
    } else if JPEG_EXTS.iter().any(|e| *e == ext) {
        let raw = fs::read(p).map_err(|e| e.to_string())?;
        let orient = read_exif_orientation(&raw);
        thumbnail_from_jpeg_bytes(&raw, orient).or_else(|_| thumbnail_from_image(p, orient))?
    } else {
        thumbnail_from_image(p, 1)?
    };

    if let Some(ref cp) = cache_path {
        write_cache_atomic(cp, &jpeg_bytes);
    }

    Ok(B64.encode(&jpeg_bytes))
}

// ---------------------------------------------------------------------------
// Source-specific decoding paths
// ---------------------------------------------------------------------------

fn thumbnail_from_raw(path: &Path) -> Result<Vec<u8>, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let exif = exif::Reader::new()
        .read_from_container(&mut Cursor::new(&bytes))
        .map_err(|e| format!("EXIF read failed: {e}"))?;

    let orient = exif
        .get_field(Tag::Orientation, In::PRIMARY)
        .and_then(|f| f.value.get_uint(0))
        .unwrap_or(1);

    // Look for an embedded JPEG preview in any IFD. Many RAW files are
    // TIFF-based, so the offsets are relative to the start of the file.
    // Pick the largest preview found.
    let mut best: Option<(usize, usize)> = None;
    for ifd in [In::PRIMARY, In::THUMBNAIL] {
        let off = exif
            .get_field(Tag::JPEGInterchangeFormat, ifd)
            .and_then(|f| f.value.get_uint(0));
        let len = exif
            .get_field(Tag::JPEGInterchangeFormatLength, ifd)
            .and_then(|f| f.value.get_uint(0));
        if let (Some(o), Some(l)) = (off, len) {
            let entry = (o as usize, l as usize);
            if entry.1 > 0 && best.map_or(true, |b| entry.1 > b.1) {
                best = Some(entry);
            }
        }
    }

    let (offset, length) =
        best.ok_or_else(|| "No embedded JPEG preview found".to_string())?;
    if offset.checked_add(length).map_or(true, |end| end > bytes.len()) {
        return Err("Preview offset out of bounds".to_string());
    }
    let preview = &bytes[offset..offset + length];

    // Try the fast DCT-scaled path first; on failure, fall back to a full
    // decode via the `image` crate, then to the raw preview bytes.
    if let Ok(out) = thumbnail_from_jpeg_bytes(preview, orient) {
        return Ok(out);
    }
    match ImageReader::with_format(Cursor::new(preview), ImageFormat::Jpeg).decode() {
        Ok(img) => encode_resized(apply_orientation_dyn(img, orient)),
        Err(_) => Ok(preview.to_vec()),
    }
}

fn read_exif_orientation(bytes: &[u8]) -> u32 {
    exif::Reader::new()
        .read_from_container(&mut Cursor::new(bytes))
        .ok()
        .and_then(|exif| {
            exif.get_field(Tag::Orientation, In::PRIMARY)
                .and_then(|f| f.value.get_uint(0))
        })
        .unwrap_or(1)
}

fn apply_orientation_dyn(img: DynamicImage, orient: u32) -> DynamicImage {
    match orient {
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        5 => img.rotate90().fliph(),
        6 => img.rotate90(),
        7 => img.rotate270().fliph(),
        8 => img.rotate270(),
        _ => img,
    }
}

fn apply_orientation_rgb(rgb: Vec<u8>, w: u32, h: u32, orient: u32) -> (Vec<u8>, u32, u32) {
    if orient <= 1 || orient > 8 {
        return (rgb, w, h);
    }
    let Some(img) = image::RgbImage::from_raw(w, h, rgb) else {
        return (Vec::new(), w, h);
    };
    let out = apply_orientation_dyn(DynamicImage::ImageRgb8(img), orient).to_rgb8();
    let (ow, oh) = out.dimensions();
    (out.into_raw(), ow, oh)
}

/// Fast path for JPEG sources (regular JPEG files and embedded RAW previews).
fn thumbnail_from_jpeg_bytes(bytes: &[u8], orient: u32) -> Result<Vec<u8>, String> {
    let mut decoder = jpeg_decoder::Decoder::new(Cursor::new(bytes));
    decoder
        .read_info()
        .map_err(|e| format!("JPEG header read failed: {e}"))?;

    // Pick a DCT scale that keeps width >= TARGET_WIDTH (then we resize
    // the rest of the way). jpeg-decoder accepts arbitrary target sizes
    // and rounds to the nearest power-of-two scale factor (1, 2, 4, 8).
    let info = decoder
        .info()
        .ok_or_else(|| "Missing JPEG info".to_string())?;
    let src_w = info.width as u32;
    let src_h = info.height as u32;
    if src_w == 0 || src_h == 0 {
        return Err("Empty JPEG".to_string());
    }

    // Aim for ~2× target so the final SIMD resize has good quality.
    let want_w = (TARGET_WIDTH * 2).min(src_w).max(TARGET_WIDTH.min(src_w));
    let ratio = want_w as f32 / src_w as f32;
    let want_h = ((src_h as f32 * ratio).round() as u32).max(1);
    let _ = decoder
        .scale(want_w as u16, want_h as u16)
        .map_err(|e| format!("JPEG scale failed: {e}"))?;

    let pixels = decoder
        .decode()
        .map_err(|e| format!("JPEG decode failed: {e}"))?;
    let info = decoder
        .info()
        .ok_or_else(|| "Missing JPEG info after decode".to_string())?;

    let (rgb, w, h) = match info.pixel_format {
        jpeg_decoder::PixelFormat::RGB24 => (pixels, info.width as u32, info.height as u32),
        jpeg_decoder::PixelFormat::L8 => {
            // Expand grayscale to RGB.
            let mut out = Vec::with_capacity(pixels.len() * 3);
            for v in &pixels {
                out.extend_from_slice(&[*v, *v, *v]);
            }
            (out, info.width as u32, info.height as u32)
        }
        // CMYK / L16 / RGBA aren't worth special-casing here; bail and let
        // the caller fall back to the slow path.
        _ => return Err("Unsupported JPEG pixel format".to_string()),
    };

    let (rgb, w, h) = apply_orientation_rgb(rgb, w, h, orient);
    resize_rgb_and_encode(&rgb, w, h)
}

fn thumbnail_from_image(path: &Path, orient: u32) -> Result<Vec<u8>, String> {
    let img = ImageReader::open(path)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .decode()
        .map_err(|e| format!("Decode failed: {e}"))?;
    encode_resized(apply_orientation_dyn(img, orient))
}

// ---------------------------------------------------------------------------
// Resize + encode
// ---------------------------------------------------------------------------

fn encode_resized(img: DynamicImage) -> Result<Vec<u8>, String> {
    let rgb = img.to_rgb8();
    let (w, h) = (rgb.width(), rgb.height());
    resize_rgb_and_encode(rgb.as_raw(), w, h)
}

fn resize_rgb_and_encode(rgb: &[u8], w: u32, h: u32) -> Result<Vec<u8>, String> {
    let (out_w, out_h) = if w > TARGET_WIDTH {
        let ratio = TARGET_WIDTH as f32 / w as f32;
        (TARGET_WIDTH, ((h as f32 * ratio).round() as u32).max(1))
    } else {
        (w, h)
    };

    let pixels: Vec<u8> = if (out_w, out_h) == (w, h) {
        rgb.to_vec()
    } else {
        let src = FirImage::from_vec_u8(
            NonZeroU32::new(w).ok_or("zero src width")?.get(),
            NonZeroU32::new(h).ok_or("zero src height")?.get(),
            rgb.to_vec(),
            PixelType::U8x3,
        )
        .map_err(|e| format!("fir src: {e}"))?;
        let mut dst = FirImage::new(out_w, out_h, PixelType::U8x3);
        let mut resizer = Resizer::new();
        resizer
            .resize(
                &src,
                &mut dst,
                &ResizeOptions::new()
                    .resize_alg(ResizeAlg::Convolution(FilterType::Lanczos3)),
            )
            .map_err(|e| format!("fir resize: {e}"))?;
        dst.into_vec()
    };

    let mut out = Vec::with_capacity(32 * 1024);
    let mut encoder = JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY);
    encoder
        .encode(
            &pixels,
            out_w,
            out_h,
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|e| format!("JPEG encode failed: {e}"))?;
    Ok(out)
}

// ---------------------------------------------------------------------------
// On-disk cache
// ---------------------------------------------------------------------------

fn cache_path_for(path: &Path) -> Option<PathBuf> {
    let dir = cache_dir()?;
    let meta = fs::metadata(path).ok()?;
    let size = meta.len();
    let mtime_ns = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);

    let mut h = std::collections::hash_map::DefaultHasher::new();
    path.to_string_lossy().hash(&mut h);
    size.hash(&mut h);
    mtime_ns.hash(&mut h);
    TARGET_WIDTH.hash(&mut h);
    JPEG_QUALITY.hash(&mut h);
    CACHE_VERSION.hash(&mut h);
    let hex = format!("{:016x}", h.finish());

    // 2-char shard to keep directory sizes reasonable.
    let shard = &hex[..2];
    let mut p = dir.to_path_buf();
    p.push(shard);
    p.push(format!("{}.jpg", &hex));
    Some(p)
}

fn write_cache_atomic(target: &Path, bytes: &[u8]) {
    let Some(parent) = target.parent() else { return };
    if fs::create_dir_all(parent).is_err() {
        return;
    }
    let tmp = parent.join(format!(
        ".{}.tmp",
        target
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("thumb")
    ));
    let write = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_data()?;
        Ok(())
    })();
    if write.is_ok() {
        let _ = fs::rename(&tmp, target);
    } else {
        let _ = fs::remove_file(&tmp);
    }
}


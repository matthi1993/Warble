//! Full-resolution image loading.
//!
//! Two paths exist:
//!
//! * `load_full_image` — legacy: returns base64-encoded JPEG bytes for the
//!   `<img>`-based UI. Kept temporarily for backwards compatibility while the
//!   GPU canvas is rolled out.
//! * `load_full_image_pixels` — new: decodes the file to raw RGBA8 pixels for
//!   binary IPC + GPU upload. This is the path the WebGL2/WebGPU canvas uses.
//!
//! For RAW files we currently extract the largest embedded JPEG preview and
//! decode that. Real RAW (sensor) decoding via e.g. `rawler` is a follow-up;
//! the API here is shaped so it can be swapped in without touching callers.
//!
//! A tiny in-process LRU caches the most recent decoded frames so back-and-
//! forth navigation in the viewer doesn't keep re-decoding the same file.

use std::collections::VecDeque;
use std::fs;
use std::io::Cursor;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use exif::{In, Tag};

const RAW_EXTS: &[&str] = &[
    "raf", "raw", "arw", "cr2", "cr3", "nef", "dng", "orf", "rw2",
];

// ---------------------------------------------------------------------------
// Legacy base64 path. Unused after this commit but retained so external
// callers keep compiling; safe to delete in a follow-up.
// ---------------------------------------------------------------------------

#[allow(dead_code)]
pub fn load_full_image(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    let ext = ext_lower(p);

    let bytes = if RAW_EXTS.iter().any(|e| *e == ext) {
        embedded_jpeg_from_raw(p)?
    } else {
        fs::read(p).map_err(|e| e.to_string())?
    };

    Ok(B64.encode(&bytes))
}

// ---------------------------------------------------------------------------
// New pixel path: decode → RGBA8 → binary blob.
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug)]
#[repr(u32)]
pub enum PixelFormat {
    Rgba8 = 0,
    // Future: Rgba16f = 1, for high-bit-depth RAW pipelines.
}

#[derive(Clone, Copy, Debug)]
#[repr(u32)]
pub enum ColorSpace {
    Srgb = 0,
    // Future: LinearRec709 = 1, DisplayP3 = 2, etc.
}

#[derive(Clone)]
pub struct DecodedImage {
    pub width: u32,
    pub height: u32,
    pub format: PixelFormat,
    pub color_space: ColorSpace,
    pub pixels: Vec<u8>,
}

impl DecodedImage {
    /// Pack as a self-describing binary blob:
    /// `[u32 width][u32 height][u32 format][u32 color_space][pixels…]`
    /// All integers little-endian. 16-byte header.
    pub fn into_blob(self) -> Vec<u8> {
        let mut out = Vec::with_capacity(16 + self.pixels.len());
        out.extend_from_slice(&self.width.to_le_bytes());
        out.extend_from_slice(&self.height.to_le_bytes());
        out.extend_from_slice(&(self.format as u32).to_le_bytes());
        out.extend_from_slice(&(self.color_space as u32).to_le_bytes());
        out.extend_from_slice(&self.pixels);
        out
    }
}

/// Return the file as encoded image bytes the browser can decode natively
/// via `createImageBitmap` (JPEG / PNG). For RAW we extract the largest
/// embedded JPEG preview. For TIFF and other non-browser-native formats we
/// transcode to JPEG q=92 in Rust so the frontend has a single fast path.
///
/// This is the preferred full-image path: shipping ~3-8 MB of encoded JPEG
/// is ~10-30× smaller than the equivalent decoded RGBA blob, and the
/// browser's `createImageBitmap` decoder is multi-threaded + SIMD.
pub fn load_full_image_bytes(path: &str) -> Result<Vec<u8>, String> {
    let p = Path::new(path);
    let mtime = fs::metadata(p)
        .and_then(|m| m.modified())
        .map_err(|e| e.to_string())?;
    if let Some(hit) = bytes_cache().lock().ok().and_then(|mut c| c.get(path, mtime)) {
        return Ok(hit);
    }

    let ext = ext_lower(p);
    let bytes = if RAW_EXTS.iter().any(|e| *e == ext) {
        embedded_jpeg_from_raw(p)?
    } else if matches!(ext.as_str(), "tif" | "tiff") {
        // Browsers don't decode TIFF in `createImageBitmap`. Transcode once.
        let raw = fs::read(p).map_err(|e| e.to_string())?;
        transcode_to_jpeg(&raw)?
    } else {
        // JPEG / PNG: pass through untouched.
        fs::read(p).map_err(|e| e.to_string())?
    };

    if let Ok(mut c) = bytes_cache().lock() {
        c.insert(path.to_string(), mtime, bytes.clone());
    }
    Ok(bytes)
}

fn transcode_to_jpeg(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let img = image::load_from_memory(bytes).map_err(|e| e.to_string())?;
    let rgb = img.to_rgb8();
    let (w, h) = rgb.dimensions();
    let mut out = Vec::with_capacity(1 << 20);
    let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 92);
    enc.encode(rgb.as_raw(), w, h, image::ExtendedColorType::Rgb8)
        .map_err(|e| e.to_string())?;
    Ok(out)
}

/// Decode the given file path to RGBA8 pixels suitable for GPU upload.
///
/// The decoded result is cached in a small LRU keyed by path + mtime so that
/// rapid navigation doesn't repeatedly re-decode the same file.
pub fn load_full_image_pixels(path: &str) -> Result<DecodedImage, String> {
    let p = Path::new(path);
    let mtime = fs::metadata(p)
        .and_then(|m| m.modified())
        .map_err(|e| e.to_string())?;

    if let Some(hit) = cache().lock().ok().and_then(|mut c| c.get(path, mtime)) {
        return Ok(hit);
    }

    let ext = ext_lower(p);
    let bytes = if RAW_EXTS.iter().any(|e| *e == ext) {
        // TODO(raw-pipeline): swap this for a real demosaic via `rawler` and
        // emit `Rgba16f` linear pixels so the future edit chain has headroom.
        embedded_jpeg_from_raw(p)?
    } else {
        fs::read(p).map_err(|e| e.to_string())?
    };

    let decoded = decode_to_rgba(&bytes)?;

    if let Ok(mut c) = cache().lock() {
        c.insert(path.to_string(), mtime, decoded.clone());
    }
    Ok(decoded)
}

fn decode_to_rgba(bytes: &[u8]) -> Result<DecodedImage, String> {
    // `image` 0.25 dispatches JPEGs through `zune-jpeg` internally, which is
    // SIMD-accelerated. PNG/TIFF go through their respective fast decoders.
    let img = image::load_from_memory(bytes).map_err(|e| e.to_string())?;
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    Ok(DecodedImage {
        width: w,
        height: h,
        format: PixelFormat::Rgba8,
        color_space: ColorSpace::Srgb,
        pixels: rgba.into_raw(),
    })
}

fn embedded_jpeg_from_raw(path: &Path) -> Result<Vec<u8>, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let exif = exif::Reader::new()
        .read_from_container(&mut Cursor::new(&bytes))
        .map_err(|e| format!("EXIF read failed: {e}"))?;

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
    Ok(bytes[offset..offset + length].to_vec())
}

fn ext_lower(p: &Path) -> String {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Tiny LRUs (one per cached payload type).
// ---------------------------------------------------------------------------

struct LruEntry<V> {
    key: String,
    mtime: SystemTime,
    value: V,
}

struct Lru<V: Clone> {
    cap: usize,
    items: VecDeque<LruEntry<V>>,
}

impl<V: Clone> Lru<V> {
    fn new(cap: usize) -> Self {
        Self {
            cap,
            items: VecDeque::with_capacity(cap),
        }
    }

    fn get(&mut self, key: &str, mtime: SystemTime) -> Option<V> {
        let pos = self
            .items
            .iter()
            .position(|e| e.key == key && e.mtime == mtime)?;
        let entry = self.items.remove(pos)?;
        let v = entry.value.clone();
        self.items.push_front(entry);
        Some(v)
    }

    fn insert(&mut self, key: String, mtime: SystemTime, value: V) {
        if let Some(pos) = self.items.iter().position(|e| e.key == key) {
            self.items.remove(pos);
        }
        self.items.push_front(LruEntry { key, mtime, value });
        while self.items.len() > self.cap {
            self.items.pop_back();
        }
    }
}

fn cache() -> &'static Mutex<Lru<DecodedImage>> {
    static CACHE: OnceLock<Mutex<Lru<DecodedImage>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(Lru::new(4)))
}

fn bytes_cache() -> &'static Mutex<Lru<Vec<u8>>> {
    static CACHE: OnceLock<Mutex<Lru<Vec<u8>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(Lru::new(8)))
}

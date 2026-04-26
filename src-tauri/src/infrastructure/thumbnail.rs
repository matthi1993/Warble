//! Thumbnail generation: JPEG base64 strings (~320px wide).

use std::fs;
use std::io::Cursor;
use std::path::Path;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use exif::{In, Tag};
use image::codecs::jpeg::JpegEncoder;
use image::{ImageFormat, ImageReader};

const TARGET_WIDTH: u32 = 320;
const JPEG_QUALITY: u8 = 80;

const RAW_EXTS: &[&str] = &[
    "raf", "raw", "arw", "cr2", "cr3", "nef", "dng", "orf", "rw2",
];

/// Generate a base64-encoded JPEG thumbnail for the given photo path.
pub fn generate_thumbnail(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();

    let jpeg_bytes = if RAW_EXTS.iter().any(|e| *e == ext) {
        thumbnail_from_raw(p)?
    } else {
        thumbnail_from_image(p)?
    };

    Ok(B64.encode(&jpeg_bytes))
}

fn thumbnail_from_raw(path: &Path) -> Result<Vec<u8>, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let exif = exif::Reader::new()
        .read_from_container(&mut Cursor::new(&bytes))
        .map_err(|e| format!("EXIF read failed: {e}"))?;

    // Look for an embedded JPEG preview in any IFD. Many RAW files (CR2, NEF,
    // ARW, ...) are TIFF-based, so the offsets are relative to the start of
    // the file. Pick the largest preview found.
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

    match ImageReader::with_format(Cursor::new(preview), ImageFormat::Jpeg).decode() {
        Ok(img) => encode_resized(img),
        Err(_) => Ok(preview.to_vec()),
    }
}

fn thumbnail_from_image(path: &Path) -> Result<Vec<u8>, String> {
    let img = ImageReader::open(path)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .decode()
        .map_err(|e| format!("Decode failed: {e}"))?;
    encode_resized(img)
}

fn encode_resized(img: image::DynamicImage) -> Result<Vec<u8>, String> {
    let resized = if img.width() > TARGET_WIDTH {
        let ratio = TARGET_WIDTH as f32 / img.width() as f32;
        let new_h = (img.height() as f32 * ratio).round() as u32;
        img.thumbnail(TARGET_WIDTH, new_h.max(1))
    } else {
        img
    };

    let rgb = resized.to_rgb8();
    let mut out = Vec::with_capacity(32 * 1024);
    let mut encoder = JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY);
    encoder
        .encode(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|e| format!("JPEG encode failed: {e}"))?;
    Ok(out)
}

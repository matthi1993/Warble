//! Full-resolution image loading: returns base64-encoded image bytes.
//!
//! For RAW files, extracts the largest embedded JPEG preview.
//! For JPEG/PNG files, returns the raw file bytes.

use std::fs;
use std::io::Cursor;
use std::path::Path;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use exif::{In, Tag};

const RAW_EXTS: &[&str] = &[
    "raf", "raw", "arw", "cr2", "cr3", "nef", "dng", "orf", "rw2",
];

pub fn load_full_image(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();

    let bytes = if RAW_EXTS.iter().any(|e| *e == ext) {
        full_preview_from_raw(p)?
    } else {
        fs::read(p).map_err(|e| e.to_string())?
    };

    Ok(B64.encode(&bytes))
}

fn full_preview_from_raw(path: &Path) -> Result<Vec<u8>, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let exif = exif::Reader::new()
        .read_from_container(&mut Cursor::new(&bytes))
        .map_err(|e| format!("EXIF read failed: {e}"))?;

    // Pick the largest embedded JPEG preview across IFDs.
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

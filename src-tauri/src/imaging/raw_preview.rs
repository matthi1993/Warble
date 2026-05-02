//! Extract the largest embedded JPEG preview from a RAW file.
//!
//! Most RAW formats are TIFF-based and store one or more JPEG previews at
//! file-relative offsets recorded in the EXIF metadata. We pick the largest
//! preview across the primary and thumbnail IFDs.

use std::fs;
use std::io::Cursor;
use std::path::Path;

use exif::{In, Tag};

pub const RAW_EXTENSIONS: &[&str] = &[
    "raf", "raw", "arw", "cr2", "cr3", "nef", "dng", "orf", "rw2",
];

pub fn is_raw_extension(ext: &str) -> bool {
    RAW_EXTENSIONS.iter().any(|e| *e == ext)
}

pub struct RawPreview {
    pub jpeg_bytes: Vec<u8>,
    pub orientation: u32,
}

pub fn extract_preview(path: &Path) -> Result<RawPreview, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let exif = exif::Reader::new()
        .read_from_container(&mut Cursor::new(&bytes))
        .map_err(|e| format!("EXIF read failed: {e}"))?;

    let orientation = exif
        .get_field(Tag::Orientation, In::PRIMARY)
        .and_then(|f| f.value.get_uint(0))
        .unwrap_or(super::exif::IDENTITY);

    let mut largest: Option<(usize, usize)> = None;
    for ifd in [In::PRIMARY, In::THUMBNAIL] {
        let off = exif
            .get_field(Tag::JPEGInterchangeFormat, ifd)
            .and_then(|f| f.value.get_uint(0));
        let len = exif
            .get_field(Tag::JPEGInterchangeFormatLength, ifd)
            .and_then(|f| f.value.get_uint(0));
        if let (Some(o), Some(l)) = (off, len) {
            let entry = (o as usize, l as usize);
            if entry.1 > 0 && largest.map_or(true, |b| entry.1 > b.1) {
                largest = Some(entry);
            }
        }
    }

    let (offset, length) = largest.ok_or_else(|| "No embedded JPEG preview found".to_string())?;
    if offset.checked_add(length).map_or(true, |end| end > bytes.len()) {
        return Err("Preview offset out of bounds".to_string());
    }
    Ok(RawPreview {
        jpeg_bytes: bytes[offset..offset + length].to_vec(),
        orientation,
    })
}

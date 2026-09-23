//! Extract only the camera's embedded JPEG preview; never develop sensor data.

use std::path::Path;

use image::codecs::jpeg::JpegEncoder;

use super::exif;

pub const RAW_EXTENSIONS: &[&str] = &[
    "raf", "raw", "arw", "cr2", "cr3", "nef", "dng", "orf", "rw2",
];

pub fn is_raw_extension(ext: &str) -> bool {
    RAW_EXTENSIONS.contains(&ext)
}

pub struct RawPreview {
    pub jpeg_bytes: Vec<u8>,
    pub orientation: u32,
}

pub fn extract_preview(path: &Path) -> Result<RawPreview, String> {
    extract_preview_sized(path, None)
}

pub fn extract_preview_sized(
    path: &Path,
    max_long_side: Option<usize>,
) -> Result<RawPreview, String> {
    let params = rawler::decoders::RawDecodeParams::default();
    let image = rawler::analyze::extract_preview_pixels(path, &params)
        .map_err(|e| format!("No embedded JPEG preview available: {e}"))?;
    let orientation = exif::read_full_metadata(path)
        .map(|(orientation, _)| orientation)
        .unwrap_or(exif::IDENTITY);
    let image = exif::apply_to_dynamic(image, orientation);
    let image = match max_long_side {
        Some(limit) if limit > 0 => {
            let limit = u32::try_from(limit).unwrap_or(u32::MAX);
            image.thumbnail(limit, limit)
        }
        _ => image,
    };
    let rgb = image.to_rgb8();
    let mut jpeg_bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg_bytes, 92)
        .encode(
            &rgb,
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|e| format!("Embedded JPEG preview encode failed: {e}"))?;
    Ok(RawPreview {
        jpeg_bytes,
        orientation: exif::IDENTITY,
    })
}

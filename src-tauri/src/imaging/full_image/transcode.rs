//! Transcode a non-browser-native image (e.g. TIFF) to JPEG so the
//! frontend can hand it to `createImageBitmap`.

use image::codecs::jpeg::JpegEncoder;

const TRANSCODE_QUALITY: u8 = 92;

pub fn to_jpeg(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let img = image::load_from_memory(bytes).map_err(|e| e.to_string())?;
    let rgb = img.to_rgb8();
    let (w, h) = rgb.dimensions();
    let mut out = Vec::with_capacity(1 << 20);
    JpegEncoder::new_with_quality(&mut out, TRANSCODE_QUALITY)
        .encode(rgb.as_raw(), w, h, image::ExtendedColorType::Rgb8)
        .map_err(|e| e.to_string())?;
    Ok(out)
}

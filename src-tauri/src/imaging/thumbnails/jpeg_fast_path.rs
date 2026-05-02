//! Fast JPEG decode path: uses `jpeg-decoder`'s DCT scaling to downscale
//! by powers of two during decode (typically 4-16× faster than a full
//! decode). Returns RGB8 pixels ready for the resize stage.

use std::io::Cursor;

pub struct DecodedRgb {
    pub pixels: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Decode `bytes` to RGB8, scaled down so the result is at least
/// `min_width` wide (when the source is larger). Returns an error if the
/// decoder reports an unsupported pixel format — callers should fall back
/// to a full decode in that case.
pub fn decode_jpeg_scaled(bytes: &[u8], min_width: u32) -> Result<DecodedRgb, String> {
    let mut decoder = jpeg_decoder::Decoder::new(Cursor::new(bytes));
    decoder
        .read_info()
        .map_err(|e| format!("JPEG header read failed: {e}"))?;

    let info = decoder
        .info()
        .ok_or_else(|| "Missing JPEG info".to_string())?;
    let src_w = info.width as u32;
    let src_h = info.height as u32;
    if src_w == 0 || src_h == 0 {
        return Err("Empty JPEG".to_string());
    }

    // Aim for ~2× the minimum so the final SIMD resize has good quality.
    // jpeg-decoder rounds to the nearest power-of-two scale (1/2/4/8).
    let want_w = (min_width * 2).min(src_w).max(min_width.min(src_w));
    let ratio = want_w as f32 / src_w as f32;
    let want_h = ((src_h as f32 * ratio).round() as u32).max(1);
    decoder
        .scale(want_w as u16, want_h as u16)
        .map_err(|e| format!("JPEG scale failed: {e}"))?;

    let pixels = decoder
        .decode()
        .map_err(|e| format!("JPEG decode failed: {e}"))?;
    let info = decoder
        .info()
        .ok_or_else(|| "Missing JPEG info after decode".to_string())?;
    let w = info.width as u32;
    let h = info.height as u32;

    let rgb = match info.pixel_format {
        jpeg_decoder::PixelFormat::RGB24 => pixels,
        jpeg_decoder::PixelFormat::L8 => {
            let mut out = Vec::with_capacity(pixels.len() * 3);
            for v in &pixels {
                out.extend_from_slice(&[*v, *v, *v]);
            }
            out
        }
        // CMYK / L16 / RGBA are rare here; let the caller use the slow path.
        _ => return Err("Unsupported JPEG pixel format".to_string()),
    };

    Ok(DecodedRgb {
        pixels: rgb,
        width: w,
        height: h,
    })
}

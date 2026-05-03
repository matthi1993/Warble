//! SIMD-accelerated downscale + JPEG re-encode used by the thumbnail pipeline.

use std::num::NonZeroU32;

use fast_image_resize::images::Image as FirImage;
use fast_image_resize::{FilterType, PixelType, ResizeAlg, ResizeOptions, Resizer};
use image::codecs::jpeg::JpegEncoder;
use image::DynamicImage;

/// Downscale `rgb` (RGB8) so its width fits in `target_width`, preserving
/// aspect ratio, then JPEG-encode at `quality`. If the source is already
/// narrow enough the buffer is encoded unchanged.
pub fn downscale_rgb_to_jpeg(
    rgb: &[u8],
    width: u32,
    height: u32,
    target_width: u32,
    quality: u8,
) -> Result<Vec<u8>, String> {
    let (out_w, out_h) = if width > target_width {
        let ratio = target_width as f32 / width as f32;
        (
            target_width,
            ((height as f32 * ratio).round() as u32).max(1),
        )
    } else {
        (width, height)
    };

    let pixels: Vec<u8> = if (out_w, out_h) == (width, height) {
        rgb.to_vec()
    } else {
        let src = FirImage::from_vec_u8(
            NonZeroU32::new(width).ok_or("zero src width")?.get(),
            NonZeroU32::new(height).ok_or("zero src height")?.get(),
            rgb.to_vec(),
            PixelType::U8x3,
        )
        .map_err(|e| format!("fir src: {e}"))?;
        let mut dst = FirImage::new(out_w, out_h, PixelType::U8x3);
        Resizer::new()
            .resize(
                &src,
                &mut dst,
                &ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FilterType::Lanczos3)),
            )
            .map_err(|e| format!("fir resize: {e}"))?;
        dst.into_vec()
    };

    encode_jpeg(&pixels, out_w, out_h, quality)
}

/// Convert `img` to RGB8 and run it through `downscale_rgb_to_jpeg`.
pub fn downscale_dynamic_to_jpeg(
    img: DynamicImage,
    target_width: u32,
    quality: u8,
) -> Result<Vec<u8>, String> {
    let rgb = img.to_rgb8();
    let (w, h) = (rgb.width(), rgb.height());
    downscale_rgb_to_jpeg(rgb.as_raw(), w, h, target_width, quality)
}

/// Convert `img` to RGB8 and downscale so its longest side fits in
/// `target_long_side`, preserving aspect ratio. Pass-through if the
/// source is already small enough.
pub fn downscale_dynamic_long_side_to_jpeg(
    img: DynamicImage,
    target_long_side: u32,
    quality: u8,
) -> Result<Vec<u8>, String> {
    let rgb = img.to_rgb8();
    let (w, h) = (rgb.width(), rgb.height());
    // Map "long side" to an equivalent target_width for `downscale_rgb_to_jpeg`.
    let target_width = if w >= h {
        target_long_side
    } else {
        // Portrait: pick the width that scales the height down to
        // `target_long_side`. Round up so we never overshoot.
        let ratio = target_long_side as f32 / h as f32;
        ((w as f32 * ratio).round() as u32).max(1)
    };
    downscale_rgb_to_jpeg(rgb.as_raw(), w, h, target_width, quality)
}

fn encode_jpeg(rgb: &[u8], width: u32, height: u32, quality: u8) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(32 * 1024);
    JpegEncoder::new_with_quality(&mut out, quality)
        .encode(rgb, width, height, image::ExtendedColorType::Rgb8)
        .map_err(|e| format!("JPEG encode failed: {e}"))?;
    Ok(out)
}

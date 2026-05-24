//! Decode a RAW file into a JPEG byte buffer the rest of the pipeline
//! can consume.
//!
//! The decoder pairs two crates:
//!
//! * [`rawler`] parses the RAW container and produces a normalized
//!   [`rawler::RawImage`] (sensor pixels, CFA, white balance, color
//!   matrix, orientation). It has an up-to-date camera database that
//!   includes modern Fujifilm bodies like the X100VI.
//! * [`imagepipe`] runs the actual development pipeline (rescale,
//!   demosaic, white balance, color matrix, base curve, sRGB gamma,
//!   transform/rotate). Its demosaic step is CFA-agnostic so it
//!   handles X-Trans patterns as well as Bayer.
//!
//! Rather than pull both decoders in for parsing we convert
//! `rawler::RawImage` to `rawloader::RawImage` (the format imagepipe
//! expects) and feed it through `imagepipe`'s pipeline. This gives us
//! rawler's breadth of camera support combined with imagepipe's
//! finished color pipeline.
//!
//! Because the output pixels are already rotated to display orientation
//! by imagepipe's `transform` op we report [`super::exif::IDENTITY`] so
//! downstream stages don't rotate a second time.

use std::path::Path;

use image::codecs::jpeg::JpegEncoder;

pub const RAW_EXTENSIONS: &[&str] = &[
    "raf", "raw", "arw", "cr2", "cr3", "nef", "dng", "orf", "rw2",
];

/// Quality of the intermediate JPEG we hand to the rest of the pipeline.
/// Chosen to be visually lossless against the demosaiced 8-bit source.
const RAW_JPEG_QUALITY: u8 = 92;

pub fn is_raw_extension(ext: &str) -> bool {
    RAW_EXTENSIONS.iter().any(|e| *e == ext)
}

pub struct RawPreview {
    pub jpeg_bytes: Vec<u8>,
    /// Always [`super::exif::IDENTITY`] — `imagepipe` rotates the
    /// output to display orientation for us.
    pub orientation: u32,
}

pub fn extract_preview(path: &Path) -> Result<RawPreview, String> {
    // 1. Parse the RAW container with rawler (broad camera support).
    let r = rawler::decode_file(path).map_err(|e| format!("RAW decode failed: {e}"))?;

    // 2. Bridge rawler::RawImage → rawloader::RawImage so we can feed
    //    it into imagepipe's pipeline.
    let bridged = bridge_to_rawloader(r)?;

    // 3. Run the imagepipe pipeline.
    let mut pipeline = imagepipe::Pipeline::new_from_source(imagepipe::ImageSource::Raw(bridged))
        .map_err(|e| format!("RAW pipeline init failed: {e}"))?;
    let decoded = pipeline
        .output_8bit(None)
        .map_err(|e| format!("RAW pipeline output failed: {e}"))?;

    let width = u32::try_from(decoded.width).map_err(|_| "RAW image too large".to_string())?;
    let height = u32::try_from(decoded.height).map_err(|_| "RAW image too large".to_string())?;

    let mut out = Vec::with_capacity(decoded.data.len() / 4);
    JpegEncoder::new_with_quality(&mut out, RAW_JPEG_QUALITY)
        .encode(&decoded.data, width, height, image::ExtendedColorType::Rgb8)
        .map_err(|e| format!("RAW JPEG encode failed: {e}"))?;

    Ok(RawPreview {
        jpeg_bytes: out,
        orientation: super::exif::IDENTITY,
    })
}

/// Convert a `rawler::RawImage` into the older `rawloader::RawImage`
/// shape that `imagepipe` was originally built against. The field
/// layouts differ but the underlying data is the same.
fn bridge_to_rawloader(r: rawler::rawimage::RawImage) -> Result<rawloader::RawImage, String> {
    use rawler::rawimage::{RawImageData as RlrData, RawPhotometricInterpretation};

    // CFA pattern: both crates use the same string convention
    // ("RGGB", 36-char X-Trans, etc.). Build a fresh rawloader CFA from it.
    let cfa_name = match &r.photometric {
        RawPhotometricInterpretation::Cfa(cfg) => cfg.cfa.name.clone(),
        _ => return Err("Unsupported RAW photometric (non-CFA)".into()),
    };
    let rl_cfa = rawloader::CFA::new(&cfa_name);

    let data = match r.data {
        RlrData::Integer(v) => rawloader::RawImageData::Integer(v),
        RlrData::Float(v) => rawloader::RawImageData::Float(v),
    };

    // Crops: rawloader uses [top, right, bottom, left] insets (in pixels)
    // from each side. rawler stores a `Rect` of the kept area instead.
    let crops = match r.crop_area.or(r.active_area) {
        Some(rect) => {
            let top = rect.p.y;
            let left = rect.p.x;
            let right = r.width.saturating_sub(left + rect.d.w);
            let bottom = r.height.saturating_sub(top + rect.d.h);
            [top, right, bottom, left]
        }
        None => [0, 0, 0, 0],
    };

    // Black areas: rawloader uses (top, right, bottom, left) tuples.
    let blackareas: Vec<(u64, u64, u64, u64)> = r
        .blackareas
        .iter()
        .map(|rect| {
            let top = rect.p.y as u64;
            let left = rect.p.x as u64;
            let right = (rect.p.x + rect.d.w) as u64;
            let bottom = (rect.p.y + rect.d.h) as u64;
            (top, right, bottom, left)
        })
        .collect();

    let orientation = rawloader::Orientation::from_u16(r.orientation.to_u16());

    let whitelevels = level_to_u16_array(r.whitelevel.as_bayer_array());
    let blacklevels = level_to_u16_array(r.blacklevel.as_bayer_array());

    // The `xyz_to_cam` field on `rawler::RawImage` is deprecated and
    // left as all-zeroes by all decoders in 0.7.2 — the real matrix
    // lives in `color_matrix: HashMap<Illuminant, FlatColorMatrix>`.
    // Multiplying by an all-zero matrix in imagepipe's calibrate step
    // produces a fully black image, so we have to pull the matrix out
    // ourselves. Prefer the D65 entry, fall back to any available one.
    let xyz_to_cam = extract_xyz_to_cam(&r.color_matrix);

    Ok(rawloader::RawImage {
        make: r.make,
        model: r.model,
        clean_make: r.clean_make,
        clean_model: r.clean_model,
        width: r.width,
        height: r.height,
        cpp: r.cpp,
        wb_coeffs: r.wb_coeffs,
        whitelevels,
        blacklevels,
        xyz_to_cam,
        cfa: rl_cfa,
        crops,
        blackareas,
        orientation,
        data,
    })
}

fn extract_xyz_to_cam(
    color_matrix: &std::collections::HashMap<rawler::imgop::xyz::Illuminant, rawler::imgop::xyz::FlatColorMatrix>,
) -> [[f32; 3]; 4] {
    let mut out = [[0.0_f32; 3]; 4];
    let found = color_matrix
        .iter()
        .find(|(illuminant, _)| **illuminant == rawler::imgop::xyz::Illuminant::D65)
        .or_else(|| color_matrix.iter().next());
    if let Some((_, matrix)) = found {
        if matrix.len() % 3 == 0 {
            let components = (matrix.len() / 3).min(4);
            for i in 0..components {
                for j in 0..3 {
                    out[i][j] = matrix[i * 3 + j];
                }
            }
        }
    }
    out
}

fn level_to_u16_array(arr: [f32; 4]) -> [u16; 4] {
    [
        clamp_to_u16(arr[0]),
        clamp_to_u16(arr[1]),
        clamp_to_u16(arr[2]),
        clamp_to_u16(arr[3]),
    ]
}

fn clamp_to_u16(v: f32) -> u16 {
    if v.is_nan() {
        0
    } else if v <= 0.0 {
        0
    } else if v >= u16::MAX as f32 {
        u16::MAX
    } else {
        v.round() as u16
    }
}

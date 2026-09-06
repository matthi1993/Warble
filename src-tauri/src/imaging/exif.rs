//! EXIF orientation: read the orientation tag and apply it to decoded pixels.

use std::io::Cursor;
use std::path::Path;

use exif::{Exif, In, Tag, Value};
use image::DynamicImage;
use serde::{Deserialize, Serialize};

/// EXIF orientation `1` = identity (no rotation, no flip).
pub const IDENTITY: u32 = 1;

pub fn apply_to_dynamic(img: DynamicImage, orient: u32) -> DynamicImage {
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

/// Apply orientation to a packed RGB8 buffer. Returns the (possibly rotated)
/// pixels and their new dimensions. An invalid orientation is treated as
/// identity.
pub fn apply_to_rgb8(rgb: Vec<u8>, w: u32, h: u32, orient: u32) -> (Vec<u8>, u32, u32) {
    if orient <= IDENTITY || orient > 8 {
        return (rgb, w, h);
    }
    let Some(img) = image::RgbImage::from_raw(w, h, rgb) else {
        return (Vec::new(), w, h);
    };
    let out = apply_to_dynamic(DynamicImage::ImageRgb8(img), orient).to_rgb8();
    let (ow, oh) = out.dimensions();
    (out.into_raw(), ow, oh)
}

/// Human-readable EXIF metadata for the edit panel. All fields optional —
/// the frontend hides any that are empty so non-camera images don't show
/// blank rows.
#[derive(Debug, Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct ExifMetadata {
    // Camera body
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub camera_serial: Option<String>,
    pub software: Option<String>,

    // Lens
    pub lens_make: Option<String>,
    pub lens_model: Option<String>,
    pub lens_serial: Option<String>,

    // Exposure
    pub iso: Option<String>,
    pub shutter_speed: Option<String>,
    pub aperture: Option<String>,
    pub focal_length: Option<String>,
    pub focal_length_35mm: Option<String>,
    pub exposure_compensation: Option<String>,
    pub exposure_program: Option<String>,
    pub exposure_mode: Option<String>,
    pub metering_mode: Option<String>,
    pub white_balance: Option<String>,
    pub flash: Option<String>,

    // Image
    pub pixel_width: Option<u32>,
    pub pixel_height: Option<u32>,
    pub orientation: Option<String>,
    pub color_space: Option<String>,

    // Provenance
    pub date_taken: Option<String>,
    pub artist: Option<String>,
    pub copyright: Option<String>,

    // Location
    pub gps_latitude: Option<f64>,
    pub gps_longitude: Option<f64>,
    pub gps_altitude: Option<String>,
}

/// Read EXIF metadata from the file at `path`. Returns the raw
/// orientation tag (1..=8 — see [`IDENTITY`]) alongside the parsed
/// metadata. Returns `None` when the file has no readable EXIF
/// container at all so callers can distinguish "no EXIF" from
/// "EXIF present, fields all blank".
pub fn read_full_metadata(path: &Path) -> Option<(u32, ExifMetadata)> {
    let file = std::fs::File::open(path).ok()?;
    let mut bufreader = std::io::BufReader::new(&file);
    let exif = exif::Reader::new()
        .read_from_container(&mut bufreader)
        .ok()?;
    Some((orientation_value(&exif), extract(&exif)))
}

/// Same as [`read_full_metadata`] but for in-memory bytes (e.g. a
/// JPEG already loaded for decoding). Lets callers warm the metadata
/// cache without reopening the file.
pub fn read_full_metadata_from_bytes(bytes: &[u8]) -> Option<(u32, ExifMetadata)> {
    let exif = exif::Reader::new()
        .read_from_container(&mut Cursor::new(bytes))
        .ok()?;
    Some((orientation_value(&exif), extract(&exif)))
}

fn orientation_value(exif: &Exif) -> u32 {
    exif.get_field(Tag::Orientation, In::PRIMARY)
        .and_then(|f| f.value.get_uint(0))
        .unwrap_or(IDENTITY)
}

fn extract(exif: &Exif) -> ExifMetadata {
    let mut m = ExifMetadata::default();
    m.camera_make = string_field(exif, Tag::Make);
    m.camera_model = string_field(exif, Tag::Model);
    m.camera_serial = string_field(exif, Tag::BodySerialNumber);
    m.software = string_field(exif, Tag::Software);

    m.lens_make = string_field(exif, Tag::LensMake);
    m.lens_model = string_field(exif, Tag::LensModel);
    m.lens_serial = string_field(exif, Tag::LensSerialNumber);

    m.iso = iso(exif);
    m.shutter_speed = shutter(exif);
    m.aperture = aperture(exif);
    m.focal_length = focal_length(exif);
    m.focal_length_35mm = focal_length_35mm(exif);
    m.exposure_compensation = exposure_compensation(exif);
    m.exposure_program = exposure_program(exif);
    m.exposure_mode = exposure_mode(exif);
    m.metering_mode = metering_mode(exif);
    m.white_balance = white_balance(exif);
    m.flash = flash(exif);

    m.pixel_width = uint_field(exif, Tag::PixelXDimension)
        .or_else(|| uint_field(exif, Tag::ImageWidth));
    m.pixel_height = uint_field(exif, Tag::PixelYDimension)
        .or_else(|| uint_field(exif, Tag::ImageLength));
    m.orientation = orientation_label(exif);
    m.color_space = color_space(exif);

    m.date_taken = string_field(exif, Tag::DateTimeOriginal)
        .or_else(|| string_field(exif, Tag::DateTime));
    m.artist = string_field(exif, Tag::Artist);
    m.copyright = string_field(exif, Tag::Copyright);

    let (lat, lon, alt) = gps(exif);
    m.gps_latitude = lat;
    m.gps_longitude = lon;
    m.gps_altitude = alt;
    m
}

fn uint_field(exif: &Exif, tag: Tag) -> Option<u32> {
    exif.get_field(tag, In::PRIMARY)
        .and_then(|f| f.value.get_uint(0))
}

fn string_field(exif: &Exif, tag: Tag) -> Option<String> {
    let f = exif.get_field(tag, In::PRIMARY)?;
    let raw = match &f.value {
        Value::Ascii(parts) => parts
            .iter()
            .map(|bs| String::from_utf8_lossy(bs).into_owned())
            .collect::<Vec<_>>()
            .join(" "),
        _ => f.display_value().to_string(),
    };
    let trimmed = raw.trim().trim_matches('"').trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn iso(exif: &Exif) -> Option<String> {
    // Modern files use PhotographicSensitivity; older ones ISOSpeed.
    for tag in [Tag::PhotographicSensitivity, Tag::ISOSpeed] {
        if let Some(f) = exif.get_field(tag, In::PRIMARY) {
            if let Some(v) = f.value.get_uint(0) {
                return Some(format!("ISO {}", v));
            }
        }
    }
    None
}

fn shutter(exif: &Exif) -> Option<String> {
    let f = exif.get_field(Tag::ExposureTime, In::PRIMARY)?;
    if let Value::Rational(rs) = &f.value {
        let r = rs.first()?;
        if r.num == 0 || r.denom == 0 {
            return None;
        }
        let secs = r.num as f64 / r.denom as f64;
        if secs >= 1.0 {
            return Some(format!("{:.1}s", secs));
        }
        // Express short exposures as 1/N where N is rounded.
        let denom = (r.denom as f64 / r.num as f64).round() as u64;
        return Some(format!("1/{}s", denom));
    }
    None
}

fn aperture(exif: &Exif) -> Option<String> {
    let f = exif.get_field(Tag::FNumber, In::PRIMARY)?;
    if let Value::Rational(rs) = &f.value {
        let r = rs.first()?;
        if r.denom == 0 {
            return None;
        }
        let v = r.num as f64 / r.denom as f64;
        return Some(format!("f/{:.1}", v));
    }
    None
}

fn focal_length(exif: &Exif) -> Option<String> {
    let f = exif.get_field(Tag::FocalLength, In::PRIMARY)?;
    if let Value::Rational(rs) = &f.value {
        let r = rs.first()?;
        if r.denom == 0 {
            return None;
        }
        let v = r.num as f64 / r.denom as f64;
        return Some(format!("{:.0}mm", v));
    }
    None
}

fn focal_length_35mm(exif: &Exif) -> Option<String> {
    let f = exif.get_field(Tag::FocalLengthIn35mmFilm, In::PRIMARY)?;
    let v = f.value.get_uint(0)?;
    Some(format!("{}mm", v))
}

fn exposure_compensation(exif: &Exif) -> Option<String> {
    let f = exif.get_field(Tag::ExposureBiasValue, In::PRIMARY)?;
    if let Value::SRational(rs) = &f.value {
        let r = rs.first()?;
        if r.denom == 0 {
            return None;
        }
        let v = r.num as f64 / r.denom as f64;
        if v.abs() < 0.05 {
            return Some("0 EV".to_string());
        }
        return Some(format!("{:+.1} EV", v));
    }
    None
}

fn exposure_program(exif: &Exif) -> Option<String> {
    let v = uint_field(exif, Tag::ExposureProgram)?;
    Some(
        match v {
            0 => "Not defined",
            1 => "Manual",
            2 => "Program AE",
            3 => "Aperture priority",
            4 => "Shutter priority",
            5 => "Creative",
            6 => "Action",
            7 => "Portrait",
            8 => "Landscape",
            _ => return None,
        }
        .to_string(),
    )
}

fn exposure_mode(exif: &Exif) -> Option<String> {
    let v = uint_field(exif, Tag::ExposureMode)?;
    Some(
        match v {
            0 => "Auto",
            1 => "Manual",
            2 => "Auto bracket",
            _ => return None,
        }
        .to_string(),
    )
}

fn metering_mode(exif: &Exif) -> Option<String> {
    let v = uint_field(exif, Tag::MeteringMode)?;
    Some(
        match v {
            0 => "Unknown",
            1 => "Average",
            2 => "Center-weighted",
            3 => "Spot",
            4 => "Multi-spot",
            5 => "Pattern",
            6 => "Partial",
            255 => "Other",
            _ => return None,
        }
        .to_string(),
    )
}

fn white_balance(exif: &Exif) -> Option<String> {
    let v = uint_field(exif, Tag::WhiteBalance)?;
    Some(
        match v {
            0 => "Auto",
            1 => "Manual",
            _ => return None,
        }
        .to_string(),
    )
}

fn flash(exif: &Exif) -> Option<String> {
    let v = uint_field(exif, Tag::Flash)?;
    let fired = (v & 0x1) != 0;
    let mode_bits = (v >> 3) & 0x3;
    let no_flash_function = (v & 0x20) != 0;
    let red_eye = (v & 0x40) != 0;
    if no_flash_function {
        return Some("No flash".to_string());
    }
    let mut parts: Vec<&str> = Vec::new();
    parts.push(if fired { "Fired" } else { "Did not fire" });
    match mode_bits {
        1 => parts.push("forced on"),
        2 => parts.push("forced off"),
        3 => parts.push("auto"),
        _ => {}
    }
    if red_eye {
        parts.push("red-eye reduction");
    }
    Some(parts.join(", "))
}

fn color_space(exif: &Exif) -> Option<String> {
    let v = uint_field(exif, Tag::ColorSpace)?;
    Some(
        match v {
            1 => "sRGB",
            2 => "Adobe RGB",
            65535 => "Uncalibrated",
            _ => return None,
        }
        .to_string(),
    )
}

fn orientation_label(exif: &Exif) -> Option<String> {
    let v = uint_field(exif, Tag::Orientation)?;
    Some(
        match v {
            1 => "Horizontal",
            2 => "Mirrored",
            3 => "Rotated 180°",
            4 => "Mirrored vertical",
            5 => "Mirrored, rotated 90° CCW",
            6 => "Rotated 90° CW",
            7 => "Mirrored, rotated 90° CW",
            8 => "Rotated 90° CCW",
            _ => return None,
        }
        .to_string(),
    )
}

fn rational_to_f64(v: &Value, idx: usize) -> Option<f64> {
    match v {
        Value::Rational(rs) => {
            let r = rs.get(idx)?;
            if r.denom == 0 {
                None
            } else {
                Some(r.num as f64 / r.denom as f64)
            }
        }
        Value::SRational(rs) => {
            let r = rs.get(idx)?;
            if r.denom == 0 {
                None
            } else {
                Some(r.num as f64 / r.denom as f64)
            }
        }
        _ => None,
    }
}

fn gps_coord(exif: &Exif, value_tag: Tag, ref_tag: Tag) -> Option<f64> {
    let f = exif.get_field(value_tag, In::PRIMARY)?;
    let deg = rational_to_f64(&f.value, 0)?;
    let min = rational_to_f64(&f.value, 1).unwrap_or(0.0);
    let sec = rational_to_f64(&f.value, 2).unwrap_or(0.0);
    let mut decimal = deg + min / 60.0 + sec / 3600.0;
    let r = exif.get_field(ref_tag, In::PRIMARY)?;
    let dir = r.display_value().to_string();
    let dir_trim = dir.trim().trim_matches('"').to_uppercase();
    if dir_trim.starts_with('S') || dir_trim.starts_with('W') {
        decimal = -decimal;
    }
    Some(decimal)
}

fn gps(exif: &Exif) -> (Option<f64>, Option<f64>, Option<String>) {
    let lat = gps_coord(exif, Tag::GPSLatitude, Tag::GPSLatitudeRef);
    let lon = gps_coord(exif, Tag::GPSLongitude, Tag::GPSLongitudeRef);
    let alt = exif
        .get_field(Tag::GPSAltitude, In::PRIMARY)
        .and_then(|f| rational_to_f64(&f.value, 0))
        .map(|v| {
            let sign = exif
                .get_field(Tag::GPSAltitudeRef, In::PRIMARY)
                .and_then(|f| f.value.get_uint(0))
                .unwrap_or(0);
            let signed = if sign == 1 { -v } else { v };
            format!("{:.0} m", signed)
        });
    (lat, lon, alt)
}

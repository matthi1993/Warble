//! EXIF orientation: read the orientation tag and apply it to decoded pixels.

use std::io::Cursor;

use exif::{In, Tag};
use image::DynamicImage;

/// EXIF orientation `1` = identity (no rotation, no flip).
pub const IDENTITY: u32 = 1;

/// Read the primary IFD orientation tag, or `IDENTITY` if missing/unreadable.
pub fn read_orientation(bytes: &[u8]) -> u32 {
    exif::Reader::new()
        .read_from_container(&mut Cursor::new(bytes))
        .ok()
        .and_then(|exif| {
            exif.get_field(Tag::Orientation, In::PRIMARY)
                .and_then(|f| f.value.get_uint(0))
        })
        .unwrap_or(IDENTITY)
}

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

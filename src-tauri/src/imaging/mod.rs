//! Imaging domain: decoding, EXIF orientation, RAW previews, thumbnails,
//! full-resolution image bytes for the canvas viewer.

#[cfg(any(target_os = "ios", target_os = "macos"))]
pub mod apple_heif;
pub mod edits;
pub mod exif;
pub mod exif_cache;
pub mod full_image;
pub mod hd_image;
mod jpeg_fast_path;
pub mod raw_preview;
mod resize;
pub mod thumbnails;
mod video_metadata;

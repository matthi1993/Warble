//! Non-destructive edit data types persisted in the SQLite
//! `photo_edits` table.
//!
//! Edits are applied at render time on the frontend canvas (see
//! `pf-image-canvas`) by sub-region drawing of the decoded
//! `ImageBitmap`. The backend stores them and hands them back, but
//! does NOT decode/re-encode the source image — that round trip is
//! both very slow (a 40 MP JPEG re-encode is ~15–25 s on the pure
//! Rust encoder) and unnecessary when the bitmap is already in GPU
//! memory ready to be cropped on draw.
//!
//! Currently supported:
//!   - Crop: a rectangle defined in normalised coordinates (0..1) of
//!     the original image. The frontend chooses an aspect ratio and
//!     orientation; the resulting rectangle is what we persist.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CropEdit {
    /// Left edge as a fraction of original width (0..1).
    pub x: f32,
    /// Top edge as a fraction of original height (0..1).
    pub y: f32,
    /// Width as a fraction of original width (0..1).
    pub width: f32,
    /// Height as a fraction of original height (0..1).
    pub height: f32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoEdits {
    #[serde(default)]
    pub crop: Option<CropEdit>,
}

impl PhotoEdits {
    pub fn is_empty(&self) -> bool {
        self.crop.is_none()
    }
}

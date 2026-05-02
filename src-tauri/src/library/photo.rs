use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Photo {
    pub path: String,
    pub filename: String,
    /// All file extensions (lowercase, no dot) belonging to the same stem in
    /// the same folder. Sidecar pairs (e.g. `IMG_0001.jpg` + `IMG_0001.RAF`)
    /// share one entry, with viewable formats listed first.
    #[serde(default)]
    pub extensions: Vec<String>,
}

/// File extensions accepted when scanning a folder for photos.
pub const PHOTO_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "tiff", "raf", "raw", "arw", "cr2", "cr3", "nef",
];

/// Extensions the viewer can natively render, in preference order. Used to
/// pick a primary file when a JPEG/RAW pair shares a stem.
const VIEWABLE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "tiff"];

pub fn is_photo_extension(ext: &str) -> bool {
    PHOTO_EXTENSIONS.iter().any(|e| *e == ext)
}

pub fn viewable_rank(ext: &str) -> usize {
    VIEWABLE_EXTENSIONS
        .iter()
        .position(|e| *e == ext)
        .unwrap_or(VIEWABLE_EXTENSIONS.len())
}

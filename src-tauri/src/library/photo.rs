use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhotoFile {
    /// Absolute path to the file on disk.
    pub path: String,
    /// Lowercased extension (no dot).
    pub extension: String,
    /// Variant key. `"base"` for the primary file (no parenthesised suffix),
    /// or the contents of the trailing parentheses (e.g. `"1"`, `"edit"`).
    pub variant: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Photo {
    pub path: String,
    pub filename: String,
    /// All file extensions (lowercase, no dot) belonging to the same stem in
    /// the same folder. Sidecar pairs (e.g. `IMG_0001.jpg` + `IMG_0001.RAF`)
    /// share one entry, with viewable formats listed first.
    #[serde(default)]
    pub extensions: Vec<String>,
    /// Per-file breakdown of every member of the sidecar/variant group, with
    /// variant labels parsed from `Stem (variant).ext` patterns. Empty for
    /// in-storage entries; populated when returning grouped results.
    #[serde(default)]
    pub files: Vec<PhotoFile>,
}

/// Parse a filename stem into `(base_stem, variant_key)`.
///
/// `Foo`         → (`Foo`,    `base`)
/// `Foo (1)`     → (`Foo`,    `1`)
/// `Foo (edit)`  → (`Foo`,    `edit`)
/// `Foo (a) (b)` → (`Foo (a)`,`b`)
pub fn parse_variant(stem: &str) -> (String, String) {
    if let Some(stripped) = stem.strip_suffix(')') {
        if let Some(open) = stripped.rfind('(') {
            let key = &stripped[open + 1..];
            if !key.is_empty() && !key.contains('(') && !key.contains(')') {
                let base = stripped[..open].trim_end();
                if !base.is_empty() {
                    return (base.to_string(), key.to_string());
                }
            }
        }
    }
    (stem.to_string(), "base".to_string())
}

/// File extensions accepted when scanning a folder for photos.
pub const PHOTO_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "jpe", "jfif", "png", "tif", "tiff", "webp", "bmp", "gif", "ico", "tga", "pnm",
    "ppm", "pgm", "pbm", "raf", "raw", "arw", "cr2", "cr3", "nef", "dng", "orf", "rw2",
];

pub const VIDEO_EXTENSIONS: &[&str] = &["mov", "mp4", "m4v"];

pub fn is_video_extension(ext: &str) -> bool {
    VIDEO_EXTENSIONS.iter().any(|e| e.eq_ignore_ascii_case(ext))
}

/// Extensions the viewer can render, in preference order. Used to
/// pick a primary file when a JPEG/RAW pair shares a stem.
const VIEWABLE_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "jpe", "jfif", "png", "heic", "heif", "tif", "tiff", "webp", "bmp", "gif",
    "ico", "tga", "pnm", "ppm", "pgm", "pbm",
];

pub fn is_photo_extension(ext: &str) -> bool {
    PHOTO_EXTENSIONS.iter().any(|e| e.eq_ignore_ascii_case(ext))
        || (cfg!(any(target_os = "macos", target_os = "ios"))
            && (ext.eq_ignore_ascii_case("heic") || ext.eq_ignore_ascii_case("heif")))
        || is_video_extension(ext)
}

pub fn viewable_rank(ext: &str) -> usize {
    VIEWABLE_EXTENSIONS
        .iter()
        .position(|e| *e == ext)
        .unwrap_or(VIEWABLE_EXTENSIONS.len())
}

#[cfg(test)]
mod tests {
    use super::is_photo_extension;

    #[test]
    fn accepts_common_still_image_formats() {
        for extension in [
            "jpg", "jpe", "jfif", "png", "tiff", "webp", "bmp", "gif", "ico", "tga", "pnm", "ppm",
            "pgm", "pbm", "dng",
        ] {
            assert!(
                is_photo_extension(extension),
                "{extension} should be accepted"
            );
        }
        assert!(is_photo_extension("JPG"));
    }

    #[test]
    fn includes_motion_media_in_library() {
        for extension in ["MOV", "mp4", "m4v"] {
            assert!(
                is_photo_extension(extension),
                "{extension} should be indexed"
            );
        }
        assert!(!is_photo_extension("txt"));
        if cfg!(any(target_os = "macos", target_os = "ios")) {
            assert!(is_photo_extension("HEIC"));
        }
    }
}

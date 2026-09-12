//! Portable per-photo state.
//!
//! Ratings and labels are mirrored to standard XMP sidecars so other photo
//! applications can read them. Warble-only state lives in an adjacent JSON
//! sidecar. SQLite remains a local query index and is hydrated from these
//! files whenever a media root is scanned.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::imaging::edits::PhotoEdits;
use crate::imaging::exif::{ExifMetadata, IDENTITY};
use crate::library::LibraryRepository;

const SCHEMA_VERSION: u32 = 1;
static SIDECAR_WRITE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn sidecar_write_lock() -> &'static Mutex<()> {
    SIDECAR_WRITE_LOCK.get_or_init(|| Mutex::new(()))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct SourceFingerprint {
    filename: String,
    size: i64,
    modified_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct WarbleSidecar {
    schema: u32,
    source: Option<SourceFingerprint>,
    orientation: u32,
    metadata_ready: bool,
    metadata: ExifMetadata,
    edits: PhotoEdits,
    #[serde(skip_serializing_if = "Option::is_none")]
    effects: Option<serde_json::Value>,
    updated_at: i64,
}

impl Default for WarbleSidecar {
    fn default() -> Self {
        Self {
            schema: SCHEMA_VERSION,
            source: None,
            orientation: IDENTITY,
            metadata_ready: false,
            metadata: ExifMetadata::default(),
            edits: PhotoEdits::default(),
            effects: None,
            updated_at: now_secs(),
        }
    }
}

/// Sidecar name deliberately includes the original extension. This keeps a
/// JPEG/RAW pair with the same stem unambiguous:
/// `IMG_0001.CR3.warble.json`, not `IMG_0001.warble.json`.
pub fn warble_path(source: &Path) -> PathBuf {
    append_filename(source, ".warble.json")
}

/// XMP uses the convention expected by most DAM applications: the extension
/// of `IMG_0001.CR3` is replaced with `.xmp`.
pub fn xmp_path(source: &Path) -> PathBuf {
    source.with_extension("xmp")
}

/// Return fast metadata from a valid Warble sidecar without opening the image
/// bytes. `None` means the file is absent, malformed, or belongs to an older
/// version of the source image.
pub fn read_metadata(source: &Path) -> Option<(u32, ExifMetadata)> {
    let sidecar = read_valid_warble(source)?;
    if !sidecar.metadata_ready {
        return None;
    }
    Some((sidecar.orientation, sidecar.metadata))
}

/// Update the Warble metadata cache after EXIF was parsed from the source.
/// Existing valid edits are retained; stale sidecars are never carried onto a
/// replacement file.
pub fn write_metadata(
    source: &Path,
    orientation: u32,
    metadata: &ExifMetadata,
) -> Result<(), String> {
    let _lock = sidecar_write_lock().lock().map_err(|e| e.to_string())?;
    let mut sidecar = read_valid_warble(source).unwrap_or_default();
    sidecar.schema = SCHEMA_VERSION;
    sidecar.source = Some(fingerprint(source)?);
    sidecar.orientation = normalize_orientation(orientation);
    sidecar.metadata_ready = true;
    sidecar.metadata = metadata.clone();
    sidecar.updated_at = now_secs();
    write_warble(source, &sidecar)
}

/// Persist Warble's non-destructive edit recipe next to the source image.
pub fn write_edits(source: &Path, edits: &PhotoEdits) -> Result<(), String> {
    let _lock = sidecar_write_lock().lock().map_err(|e| e.to_string())?;
    let mut sidecar = read_valid_warble(source).unwrap_or_default();
    sidecar.schema = SCHEMA_VERSION;
    sidecar.source = Some(fingerprint(source)?);
    sidecar.edits = edits.clone();
    sidecar.updated_at = now_secs();
    write_warble(source, &sidecar)
}

/// `Some(None)` means that a valid sidecar explicitly has no per-photo
/// effects; plain `None` means there is no usable sidecar yet.
pub fn read_effects(source: &Path) -> Option<Option<serde_json::Value>> {
    Some(read_valid_warble(source)?.effects)
}

/// Persist per-photo sharpening/grain (whose detailed schema is owned by the
/// frontend) without forcing the Rust side to duplicate it.
pub fn write_effects(source: &Path, effects: Option<&serde_json::Value>) -> Result<(), String> {
    let _lock = sidecar_write_lock().lock().map_err(|e| e.to_string())?;
    let mut sidecar = read_valid_warble(source).unwrap_or_default();
    sidecar.schema = SCHEMA_VERSION;
    sidecar.source = Some(fingerprint(source)?);
    sidecar.effects = effects.cloned();
    sidecar.updated_at = now_secs();
    write_warble(source, &sidecar)
}

/// Import portable photo state into SQLite. If an existing library predates
/// sidecars, its edits and ratings are exported once so no user work is lost.
/// This function never parses the source image: missing EXIF is populated
/// lazily by the existing EXIF/filter pipeline.
pub fn sync_photo_index(repo: &LibraryRepository, key: &str, source: &Path) -> Result<(), String> {
    sync_rating(repo, key, source)?;

    // A rescan may seed a legacy sidecar while the editor is open. Keep that
    // read-modify-write operation in the same critical section as edits and
    // effects so one valid update cannot replace another one.
    let _lock = sidecar_write_lock().lock().map_err(|e| e.to_string())?;

    if let Some(sidecar) = read_valid_warble(source) {
        if sidecar.metadata_ready {
            let fingerprint = fingerprint(source)?;
            let metadata_json =
                serde_json::to_string(&sidecar.metadata).map_err(|e| e.to_string())?;
            repo.set_photo_exif(
                key,
                fingerprint.modified_at,
                fingerprint.size,
                normalize_orientation(sidecar.orientation),
                &metadata_json,
            )?;
        } else {
            repo.delete_photo_exif(key)?;
        }
        if sidecar.edits.is_empty() {
            repo.delete_photo_edit(key)?;
        } else {
            let edits_json = serde_json::to_string(&sidecar.edits).map_err(|e| e.to_string())?;
            repo.set_photo_edit(key, &edits_json)?;
        }
        return Ok(());
    }

    // Only migrate user-meaningful edit state at scan time. EXIF is a cache,
    // so eagerly turning a large existing SQLite cache into thousands of
    // sidecar writes would make startup painfully slow. The EXIF pipeline
    // writes this sidecar on first metadata/filter access instead.
    let edits = repo
        .photo_edit(key)?
        .and_then(|json| serde_json::from_str::<PhotoEdits>(&json).ok())
        .unwrap_or_default();
    if edits.is_empty() {
        return Ok(());
    }
    let fingerprint = fingerprint(source)?;
    let sidecar = WarbleSidecar {
        schema: SCHEMA_VERSION,
        source: Some(fingerprint),
        orientation: IDENTITY,
        metadata_ready: false,
        metadata: ExifMetadata::default(),
        edits,
        effects: None,
        updated_at: now_secs(),
    };
    write_warble(source, &sidecar)
}

/// Mirror an internal rating to its XMP sidecar, then update the SQLite index.
/// The write is deliberately performed first: a successful command guarantees
/// that the portable representation exists as well as the local index row.
pub fn write_rating(
    repo: &LibraryRepository,
    key: &str,
    source: &Path,
    rating: i64,
    label: &str,
    rated_at: i64,
) -> Result<(), String> {
    let rating = rating.clamp(0, 5);
    let label = sanitize_label(label);
    write_xmp_rating(source, rating, label)?;
    if rating == 0 && label.is_empty() {
        repo.delete_photo_rating(key)
    } else {
        repo.set_photo_rating_row(key, rating, label, rated_at)
    }
}

fn sync_rating(repo: &LibraryRepository, key: &str, source: &Path) -> Result<(), String> {
    if let Some(Some((rating, label))) = read_xmp_rating(source) {
        let existing = repo.photo_rating(key)?;
        let unchanged = existing
            .as_ref()
            .map(|(old_rating, old_label, _)| *old_rating == rating && *old_label == label)
            .unwrap_or(false);
        let rated_at = existing
            .map(|(_, _, rated_at)| rated_at)
            .unwrap_or_else(now_secs);
        if rating == 0 && label.is_empty() {
            repo.delete_photo_rating(key)?;
        } else if !unchanged {
            repo.set_photo_rating_row(key, rating, &label, rated_at)?;
        }
        return Ok(());
    }

    // Migration path for the old SQLite-only implementation. This also
    // handles an existing XMP packet that contains unrelated fields but has
    // never carried a rating/label.
    if let Some((rating, label, _)) = repo.photo_rating(key)? {
        write_xmp_rating(source, rating, &label)?;
    }
    Ok(())
}

fn read_valid_warble(source: &Path) -> Option<WarbleSidecar> {
    let raw = fs::read_to_string(warble_path(source)).ok()?;
    let sidecar = serde_json::from_str::<WarbleSidecar>(&raw).ok()?;
    if sidecar.schema != SCHEMA_VERSION || sidecar.source.as_ref()? != &fingerprint(source).ok()? {
        return None;
    }
    Some(sidecar)
}

fn write_warble(source: &Path, sidecar: &WarbleSidecar) -> Result<(), String> {
    let raw = serde_json::to_vec(sidecar).map_err(|e| e.to_string())?;
    atomic_write(&warble_path(source), &raw)
}

/// `None` means no XMP file could be read; `Some(None)` means an XMP packet
/// exists but does not express rating/label metadata.
fn read_xmp_rating(source: &Path) -> Option<Option<(i64, String)>> {
    let raw = fs::read_to_string(xmp_path(source)).ok()?;
    let raw_rating = find_xmp_value(&raw, "xmp:Rating");
    let raw_label = find_xmp_value(&raw, "xmp:Label");
    if raw_rating.is_none() && raw_label.is_none() {
        return Some(None);
    }
    let rating = raw_rating
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0)
        .clamp(0, 5);
    let label = raw_label
        .map(|value| sanitize_label(&value).to_string())
        .unwrap_or_default();
    Some(Some((rating, label)))
}

fn write_xmp_rating(source: &Path, rating: i64, label: &str) -> Result<(), String> {
    let _lock = sidecar_write_lock().lock().map_err(|e| e.to_string())?;
    let path = xmp_path(source);
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => update_xmp_packet(raw, rating, label)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => new_xmp_packet(rating, label),
        Err(error) => return Err(format!("failed to read XMP {}: {error}", path.display())),
    };
    atomic_write(&path, raw.as_bytes())
}

/// Update only attributes in the first RDF description. This deliberately
/// preserves unrelated XMP written by Capture One or another application.
fn update_xmp_packet(mut raw: String, rating: i64, label: &str) -> Result<String, String> {
    let start = raw
        .find("<rdf:Description")
        .ok_or_else(|| "XMP does not contain an rdf:Description element".to_string())?;
    let end_offset = raw[start..]
        .find('>')
        .ok_or_else(|| "XMP rdf:Description start tag is incomplete".to_string())?;
    let end = start + end_offset;
    let mut tag = raw[start..=end].to_string();
    set_xmp_attribute(&mut tag, "xmp:Rating", &rating.to_string());
    set_xmp_attribute(&mut tag, "xmp:Label", label);
    raw.replace_range(start..=end, &tag);
    Ok(raw)
}

fn set_xmp_attribute(tag: &mut String, name: &str, value: &str) {
    if let Some((value_start, value_end)) = attribute_value_range(tag, name) {
        tag.replace_range(value_start..value_end, value);
        return;
    }
    if !tag.contains("xmlns:xmp=") {
        insert_before_tag_end(tag, " xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\"");
    }
    insert_before_tag_end(tag, &format!(" {name}=\"{value}\""));
}

fn insert_before_tag_end(tag: &mut String, text: &str) {
    let at = tag
        .strip_suffix("/>")
        .map(|_| tag.len() - 2)
        .unwrap_or(tag.len() - 1);
    tag.insert_str(at, text);
}

fn attribute_value_range(tag: &str, name: &str) -> Option<(usize, usize)> {
    let at = tag.find(&format!("{name}="))? + name.len() + 1;
    let quote = tag.as_bytes().get(at).copied()?;
    if quote != b'\'' && quote != b'\"' {
        return None;
    }
    let value_start = at + 1;
    let value_end = tag[value_start..].find(quote as char)? + value_start;
    Some((value_start, value_end))
}

fn find_xmp_value(raw: &str, name: &str) -> Option<String> {
    // Standard sidecars normally use attributes. Accept the element form too
    // because a few metadata tools serialize simple XMP properties that way.
    if let Some((start, end)) = attribute_value_range(raw, name) {
        return Some(raw[start..end].to_string());
    }
    let open = format!("<{name}>");
    let start = raw.find(&open)? + open.len();
    let end = raw[start..].find(&format!("</{name}>"))? + start;
    Some(raw[start..end].to_string())
}

fn new_xmp_packet(rating: i64, label: &str) -> String {
    format!(
        "<?xpacket begin=\"\u{feff}\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>\n<x:xmpmeta xmlns:x=\"adobe:ns:meta/\">\n  <rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">\n    <rdf:Description rdf:about=\"\" xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\" xmp:Rating=\"{rating}\" xmp:Label=\"{label}\"/>\n  </rdf:RDF>\n</x:xmpmeta>\n<?xpacket end=\"w\"?>\n"
    )
}

fn sanitize_label(label: &str) -> &str {
    match label {
        "green" | "blue" | "yellow" | "red" => label,
        _ => "",
    }
}

fn fingerprint(source: &Path) -> Result<SourceFingerprint, String> {
    let metadata = fs::metadata(source)
        .map_err(|error| format!("failed to inspect source {}: {error}", source.display()))?;
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0);
    let filename = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "photo filename is not valid UTF-8".to_string())?
        .to_string();
    Ok(SourceFingerprint {
        filename,
        size: metadata.len() as i64,
        modified_at,
    })
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("sidecar has no parent directory: {}", path.display()))?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "sidecar filename is not valid UTF-8".to_string())?;
    let temporary = parent.join(format!(".{name}.{}.tmp", uuid::Uuid::new_v4()));
    let write_result = (|| -> Result<(), String> {
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|error| format!("failed to create {}: {error}", temporary.display()))?;
        file.write_all(bytes)
            .map_err(|error| format!("failed to write {}: {error}", temporary.display()))?;
        file.sync_all()
            .map_err(|error| format!("failed to flush {}: {error}", temporary.display()))
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    fs::rename(&temporary, path).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        format!("failed to install sidecar {}: {error}", path.display())
    })
}

fn append_filename(path: &Path, suffix: &str) -> PathBuf {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    path.with_file_name(format!("{name}{suffix}"))
}

fn normalize_orientation(value: u32) -> u32 {
    if (1..=8).contains(&value) {
        value
    } else {
        IDENTITY
    }
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xmp_round_trip_preserves_unrelated_fields() {
        let dir = std::env::temp_dir().join(format!("warble-xmp-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let source = dir.join("IMG_0001.CR3");
        fs::write(&source, b"raw").unwrap();
        fs::write(
            xmp_path(&source),
            "<rdf:Description xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\" dc:title=\"Keep me\"/>",
        )
        .unwrap();

        write_xmp_rating(&source, 4, "green").unwrap();
        let raw = fs::read_to_string(xmp_path(&source)).unwrap();
        assert!(raw.contains("dc:title=\"Keep me\""));
        assert_eq!(
            read_xmp_rating(&source),
            Some(Some((4, "green".to_string())))
        );

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn stale_warble_sidecar_is_not_used() {
        let dir = std::env::temp_dir().join(format!("warble-sidecar-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let source = dir.join("IMG_0001.CR3");
        fs::write(&source, b"one").unwrap();
        write_metadata(&source, 6, &ExifMetadata::default()).unwrap();
        assert!(read_metadata(&source).is_some());
        fs::write(&source, b"a replacement source with a different size").unwrap();
        assert!(read_metadata(&source).is_none());

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn edit_and_effect_updates_preserve_each_other() {
        let dir = std::env::temp_dir().join(format!("warble-sidecar-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let source = dir.join("IMG_0001.CR3");
        fs::write(&source, b"raw").unwrap();
        let edits = PhotoEdits {
            tone: Some(crate::imaging::edits::ToneEdit {
                exposure: 1.5,
                ..Default::default()
            }),
            ..Default::default()
        };

        write_edits(&source, &edits).unwrap();
        write_effects(
            &source,
            Some(&serde_json::json!({ "grain": { "amount": 20 } })),
        )
        .unwrap();

        let sidecar = read_valid_warble(&source).unwrap();
        assert_eq!(sidecar.edits.tone.unwrap().exposure, 1.5);
        assert_eq!(
            sidecar.effects,
            Some(serde_json::json!({ "grain": { "amount": 20 } }))
        );

        fs::remove_dir_all(dir).unwrap();
    }
}

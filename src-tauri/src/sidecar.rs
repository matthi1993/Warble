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

use rusqlite::{params, Transaction};
use serde::{Deserialize, Serialize};

use crate::imaging::edits::PhotoEdits;
use crate::imaging::exif::{ExifMetadata, IDENTITY};
use crate::library::{LibraryRepository, PhotoSourceState};

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    modified_at_ns: Option<i64>,
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

/// Keep the original extension to distinguish JPEG/RAW pairs, and prefix
/// the filename so the app-specific sidecar is hidden in file explorers.
pub fn warble_path(source: &Path) -> PathBuf {
    source.with_file_name(format!(
        ".{}.warble.json",
        source.file_name().unwrap_or_default().to_string_lossy()
    ))
}

pub fn legacy_warble_path(source: &Path) -> PathBuf {
    append_filename(source, ".warble.json")
}

fn existing_warble_path(source: &Path) -> PathBuf {
    let hidden = warble_path(source);
    if hidden.exists() {
        hidden
    } else {
        legacy_warble_path(source)
    }
}

fn migrate_warble(source: &Path) -> Result<(), String> {
    let legacy = legacy_warble_path(source);
    let hidden = warble_path(source);
    if legacy.exists() && !hidden.exists() {
        fs::rename(&legacy, &hidden)
            .map_err(|error| format!("failed to hide {}: {error}", legacy.display()))?;
    }
    Ok(())
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
    let mut sidecar = sidecar_for_write(source);
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
    let mut sidecar = sidecar_for_write(source);
    sidecar.schema = SCHEMA_VERSION;
    sidecar.source = Some(fingerprint(source)?);
    sidecar.edits = edits.clone();
    sidecar.updated_at = now_secs();
    write_warble(source, &sidecar)
}

/// `Some(None)` means a readable sidecar explicitly has no per-photo
/// effects; plain `None` means there is no usable sidecar yet. Effects are
/// retained when image bytes change, unlike cached EXIF.
pub fn read_effects(source: &Path) -> Option<Option<serde_json::Value>> {
    Some(read_warble(source)?.effects)
}

/// Persist per-photo sharpening/grain (whose detailed schema is owned by the
/// frontend) without forcing the Rust side to duplicate it.
pub fn write_effects(source: &Path, effects: Option<&serde_json::Value>) -> Result<(), String> {
    let _lock = sidecar_write_lock().lock().map_err(|e| e.to_string())?;
    let mut sidecar = sidecar_for_write(source);
    sidecar.schema = SCHEMA_VERSION;
    sidecar.source = Some(fingerprint(source)?);
    sidecar.effects = effects.cloned();
    sidecar.updated_at = now_secs();
    write_warble(source, &sidecar)
}

/// Import portable state for several photos in one SQLite transaction. The
/// filesystem work remains per photo, but committing once avoids a database
/// transaction and connection lock for every sidecar in a large library.
pub fn sync_photo_index_batch(
    repo: &LibraryRepository,
    photos: &[(&str, &Path)],
) -> Result<PhotoSyncResult, String> {
    let _lock = sidecar_write_lock().lock().map_err(|e| e.to_string())?;
    for (_, source) in photos {
        migrate_warble(source)?;
    }
    repo.with_transaction(|tx| {
        let mut changes = PhotoSyncResult::default();
        for (key, source) in photos {
            let before = tx.query_row(
                "SELECT image_mtime_ns, image_size, xmp_mtime_ns, xmp_size,
                        warble_mtime_ns, warble_size
                 FROM photo_source_state WHERE path = ?1",
                params![key],
                |row| {
                    Ok(PhotoSourceState {
                        image_mtime_ns: row.get(0)?,
                        image_size: row.get(1)?,
                        xmp_mtime_ns: row.get(2)?,
                        xmp_size: row.get(3)?,
                        warble_mtime_ns: row.get(4)?,
                        warble_size: row.get(5)?,
                    })
                },
            );
            let previous = match before {
                Ok(value) => Some(value),
                Err(rusqlite::Error::QueryReturnedNoRows) => None,
                Err(error) => return Err(error.to_string()),
            };
            let current = source_state(source)?;
            if previous.as_ref().is_some_and(|old| {
                old.image_mtime_ns != current.image_mtime_ns || old.image_size != current.image_size
            }) {
                tx.execute("DELETE FROM photo_exif WHERE path = ?1", params![key])
                    .map_err(|e| e.to_string())?;
                changes.changed_images.push((*key).to_string());
            }
            if previous.as_ref() != Some(&current) {
                changes.metadata_changed = true;
            }
            let xmp_rating_removed = previous.as_ref().is_some_and(|old| {
                old.xmp_mtime_ns.is_some()
                    && (old.xmp_mtime_ns != current.xmp_mtime_ns
                        || old.xmp_size != current.xmp_size)
            });
            let warble_removed = previous.as_ref().is_some_and(|old| {
                old.warble_mtime_ns.is_some() && current.warble_mtime_ns.is_none()
            });
            sync_photo_index_tx(tx, key, source, xmp_rating_removed, warble_removed)?;
            let current = source_state(source)?;
            tx.execute(
                "INSERT INTO photo_source_state
                    (path, image_mtime_ns, image_size, xmp_mtime_ns, xmp_size,
                     warble_mtime_ns, warble_size)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(path) DO UPDATE SET
                    image_mtime_ns = excluded.image_mtime_ns,
                    image_size = excluded.image_size,
                    xmp_mtime_ns = excluded.xmp_mtime_ns,
                    xmp_size = excluded.xmp_size,
                    warble_mtime_ns = excluded.warble_mtime_ns,
                    warble_size = excluded.warble_size",
                params![
                    key,
                    current.image_mtime_ns,
                    current.image_size,
                    current.xmp_mtime_ns,
                    current.xmp_size,
                    current.warble_mtime_ns,
                    current.warble_size,
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(changes)
    })
}

#[derive(Default)]
pub struct PhotoSyncResult {
    pub changed_images: Vec<String>,
    pub metadata_changed: bool,
}

pub fn source_state(source: &Path) -> Result<PhotoSourceState, String> {
    let image = fs::metadata(source).map_err(|error| error.to_string())?;
    let (xmp_mtime_ns, xmp_size) = optional_file_state(&xmp_path(source))?;
    let (warble_mtime_ns, warble_size) = optional_file_state(&existing_warble_path(source))?;
    Ok(PhotoSourceState {
        image_mtime_ns: modified_ns(&image),
        image_size: image.len() as i64,
        xmp_mtime_ns,
        xmp_size,
        warble_mtime_ns,
        warble_size,
    })
}

fn optional_file_state(path: &Path) -> Result<(Option<i64>, Option<i64>), String> {
    match fs::metadata(path) {
        Ok(metadata) => Ok((Some(modified_ns(&metadata)), Some(metadata.len() as i64))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok((None, None)),
        Err(error) => Err(format!("failed to inspect {}: {error}", path.display())),
    }
}

fn modified_ns(metadata: &fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

fn sync_photo_index_tx(
    tx: &Transaction<'_>,
    key: &str,
    source: &Path,
    xmp_rating_removed: bool,
    warble_removed: bool,
) -> Result<(), String> {
    sync_rating_tx(tx, key, source, xmp_rating_removed)?;

    if warble_removed {
        tx.execute("DELETE FROM photo_edits WHERE path = ?1", params![key])
            .map_err(|error| error.to_string())?;
        tx.execute("DELETE FROM photo_exif WHERE path = ?1", params![key])
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    if existing_warble_path(source).exists() && read_warble(source).is_none() {
        return Err(format!(
            "cannot import unreadable sidecar for {}",
            source.display()
        ));
    }

    // A rescan may seed a legacy sidecar while the editor is open. Keep that
    // read-modify-write operation in the same critical section as edits and
    // effects so one valid update cannot replace another one.

    if let Some(sidecar) = read_warble(source) {
        if sidecar.metadata_ready && read_valid_warble(source).is_some() {
            let fingerprint = fingerprint(source)?;
            let metadata_json =
                serde_json::to_string(&sidecar.metadata).map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT INTO photo_exif
                    (path, file_mtime, file_size, orientation, metadata)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(path) DO UPDATE SET
                    file_mtime = excluded.file_mtime,
                    file_size = excluded.file_size,
                    orientation = excluded.orientation,
                    metadata = excluded.metadata",
                params![
                    key,
                    fingerprint
                        .modified_at_ns
                        .unwrap_or(fingerprint.modified_at),
                    fingerprint.size,
                    normalize_orientation(sidecar.orientation) as i64,
                    metadata_json
                ],
            )
            .map_err(|e| e.to_string())?;
        } else {
            tx.execute("DELETE FROM photo_exif WHERE path = ?1", params![key])
                .map_err(|e| e.to_string())?;
        }
        if sidecar.edits.is_empty() {
            tx.execute("DELETE FROM photo_edits WHERE path = ?1", params![key])
                .map_err(|e| e.to_string())?;
        } else {
            let edits_json = serde_json::to_string(&sidecar.edits).map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT INTO photo_edits (path, edits) VALUES (?1, ?2)
                 ON CONFLICT(path) DO UPDATE SET edits = excluded.edits",
                params![key, edits_json],
            )
            .map_err(|e| e.to_string())?;
        }
        return Ok(());
    }

    // Only migrate user-meaningful edit state at scan time. EXIF is a cache,
    // so eagerly turning a large existing SQLite cache into thousands of
    // sidecar writes would make startup painfully slow. The EXIF pipeline
    // writes this sidecar on first metadata/filter access instead.
    let edits = tx_photo_edit(tx, key)?
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

fn sync_rating_tx(
    tx: &Transaction<'_>,
    key: &str,
    source: &Path,
    xmp_rating_removed: bool,
) -> Result<(), String> {
    if let Some(Some((rating, label))) = read_xmp_rating(source) {
        let existing = tx_photo_rating(tx, key)?;
        let unchanged = existing
            .as_ref()
            .map(|(old_rating, old_label, _)| *old_rating == rating && *old_label == label)
            .unwrap_or(false);
        let rated_at = if unchanged {
            existing
                .map(|(_, _, rated_at)| rated_at)
                .unwrap_or_else(now_secs)
        } else {
            now_secs()
        };
        if rating == 0 && label.is_empty() {
            tx.execute("DELETE FROM photo_ratings WHERE path = ?1", params![key])
                .map_err(|e| e.to_string())?;
        } else if !unchanged {
            tx.execute(
                "INSERT INTO photo_ratings (path, rating, label, rated_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(path) DO UPDATE SET
                    rating = excluded.rating,
                    label = excluded.label,
                    rated_at = excluded.rated_at",
                params![key, rating, label, rated_at],
            )
            .map_err(|e| e.to_string())?;
        }
        return Ok(());
    }

    if xmp_rating_removed {
        tx.execute("DELETE FROM photo_ratings WHERE path = ?1", params![key])
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Migration path for the old SQLite-only implementation. This also
    // handles an existing XMP packet that contains unrelated fields but has
    // never carried a rating/label.
    if let Some((rating, label, _)) = tx_photo_rating(tx, key)? {
        write_xmp_rating_locked(source, rating, &label)?;
    }
    Ok(())
}

fn tx_photo_rating(tx: &Transaction<'_>, key: &str) -> Result<Option<(i64, String, i64)>, String> {
    tx.query_row(
        "SELECT rating, label, rated_at FROM photo_ratings WHERE path = ?1",
        params![key],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .map(Some)
    .or_else(|error| match error {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(other.to_string()),
    })
}

fn tx_photo_edit(tx: &Transaction<'_>, key: &str) -> Result<Option<String>, String> {
    tx.query_row(
        "SELECT edits FROM photo_edits WHERE path = ?1",
        params![key],
        |row| row.get(0),
    )
    .map(Some)
    .or_else(|error| match error {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(other.to_string()),
    })
}

fn read_valid_warble(source: &Path) -> Option<WarbleSidecar> {
    let sidecar = read_warble(source)?;
    let current = fingerprint(source).ok()?;
    let recorded = sidecar.source.as_ref()?;
    if recorded.filename != current.filename
        || recorded.size != current.size
        || recorded.modified_at != current.modified_at
        || recorded.modified_at_ns != current.modified_at_ns
    {
        return None;
    }
    Some(sidecar)
}

fn read_warble(source: &Path) -> Option<WarbleSidecar> {
    let raw = fs::read_to_string(existing_warble_path(source)).ok()?;
    let sidecar = serde_json::from_str::<WarbleSidecar>(&raw).ok()?;
    (sidecar.schema == SCHEMA_VERSION).then_some(sidecar)
}

fn sidecar_for_write(source: &Path) -> WarbleSidecar {
    let valid = read_valid_warble(source).is_some();
    let mut sidecar = read_warble(source).unwrap_or_default();
    if !valid {
        sidecar.metadata_ready = false;
        sidecar.metadata = ExifMetadata::default();
        sidecar.orientation = IDENTITY;
    }
    sidecar
}

fn write_warble(source: &Path, sidecar: &WarbleSidecar) -> Result<(), String> {
    let raw = serde_json::to_vec(sidecar).map_err(|e| e.to_string())?;
    atomic_write(&warble_path(source), &raw)?;
    let legacy = legacy_warble_path(source);
    if legacy.exists() {
        fs::remove_file(&legacy)
            .map_err(|error| format!("failed to remove {}: {error}", legacy.display()))?;
    }
    Ok(())
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
    write_xmp_rating_locked(source, rating, label)
}

fn write_xmp_rating_locked(source: &Path, rating: i64, label: &str) -> Result<(), String> {
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
    let modified_at_ns = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos().min(i64::MAX as u128) as i64);
    let filename = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "photo filename is not valid UTF-8".to_string())?
        .to_string();
    Ok(SourceFingerprint {
        filename,
        size: metadata.len() as i64,
        modified_at,
        modified_at_ns,
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
    fn legacy_warble_sidecar_is_hidden_on_sync() {
        let dir = std::env::temp_dir().join(format!("warble-hide-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let source = dir.join("photo.CR3");
        fs::write(&source, b"raw").unwrap();
        let repo = LibraryRepository::open(&dir.join("library.warble")).unwrap();
        write_edits(&source, &PhotoEdits::default()).unwrap();
        fs::rename(warble_path(&source), legacy_warble_path(&source)).unwrap();
        assert!(read_warble(&source).is_some());

        sync_photo_index_batch(&repo, &[("root/photo.CR3", &source)]).unwrap();
        assert!(warble_path(&source).exists());
        assert!(!legacy_warble_path(&source).exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn sync_imports_external_changes_without_losing_edits() {
        let dir = std::env::temp_dir().join(format!("warble-sync-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let source = dir.join("photo.jpg");
        fs::write(&source, b"first version").unwrap();
        let repo = LibraryRepository::open(&dir.join("library.warble")).unwrap();
        repo.add_media_root("root", "Photos").unwrap();
        let key = "root/photo.jpg";
        let edits = PhotoEdits {
            tone: Some(crate::imaging::edits::ToneEdit {
                exposure: 1.0,
                ..Default::default()
            }),
            ..Default::default()
        };
        write_edits(&source, &edits).unwrap();
        write_rating(&repo, key, &source, 5, "green", 1).unwrap();
        let initial = sync_photo_index_batch(&repo, &[(key, &source)]).unwrap();
        assert!(initial.metadata_changed);
        assert!(initial.changed_images.is_empty());
        repo.set_photo_exif(key, 0, 0, 1, "{}").unwrap();

        fs::write(&source, b"replacement photo content").unwrap();
        fs::write(xmp_path(&source), new_xmp_packet(2, "blue")).unwrap();
        let changes = sync_photo_index_batch(&repo, &[(key, &source)]).unwrap();
        assert_eq!(changes.changed_images, vec![key.to_string()]);
        assert_eq!(repo.all_photo_ratings().unwrap()[0].1, 2);
        assert_eq!(repo.all_photo_ratings().unwrap()[0].2, "blue");
        assert!(repo.get_photo_exif(key).unwrap().is_none());
        assert_eq!(repo.all_photo_edits().unwrap().len(), 1);
        assert!(read_metadata(&source).is_none());

        fs::remove_file(xmp_path(&source)).unwrap();
        fs::remove_file(warble_path(&source)).unwrap();
        sync_photo_index_batch(&repo, &[(key, &source)]).unwrap();
        assert!(repo.all_photo_ratings().unwrap().is_empty());
        assert!(repo.all_photo_edits().unwrap().is_empty());
        assert_eq!(fs::read(&source).unwrap(), b"replacement photo content");
        fs::remove_dir_all(dir).unwrap();
    }

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

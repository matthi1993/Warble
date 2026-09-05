//! SQLite-backed persistence for the portable library catalog.
//!
//! The database stores only metadata — image files themselves stay on disk
//! and are referenced by `<media-root UUID>/<relative path>` keys.

use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};

#[derive(Debug, Clone)]
pub struct MediaRoot {
    pub id: String,
    pub name: String,
}

pub struct LibraryRepository {
    conn: Mutex<Connection>,
}

impl LibraryRepository {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        let repo = Self {
            conn: Mutex::new(conn),
        };
        repo.migrate()?;
        Ok(repo)
    }

    fn migrate(&self) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY
            );",
        )
        .map_err(|e| e.to_string())?;

        let current: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_version",
                [],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        if current < 1 {
            conn.execute_batch(
                "CREATE TABLE imported_folders (
                    path        TEXT PRIMARY KEY,
                    imported_at INTEGER NOT NULL
                );
                INSERT INTO schema_version (version) VALUES (1);",
            )
            .map_err(|e| e.to_string())?;
        }

        if current < 2 {
            conn.execute_batch(
                "CREATE TABLE app_settings (
                    key   TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                INSERT INTO schema_version (version) VALUES (2);",
            )
            .map_err(|e| e.to_string())?;
        }

        if current < 3 {
            conn.execute_batch(
                "CREATE TABLE photo_variants (
                    path    TEXT PRIMARY KEY,
                    format  TEXT NOT NULL,
                    variant TEXT NOT NULL
                );
                INSERT INTO schema_version (version) VALUES (3);",
            )
            .map_err(|e| e.to_string())?;
        }

        if current < 4 {
            // Per-photo non-destructive edits, stored as opaque JSON
            // (currently a `CropEdit` payload). Keyed by the photo's
            // primary file path, so a JPEG with both a `base` and
            // `(1)` variant share an edit row only if the user
            // explicitly addresses each — but for now the UI only
            // edits the path being viewed.
            conn.execute_batch(
                "CREATE TABLE photo_edits (
                    path  TEXT PRIMARY KEY,
                    edits TEXT NOT NULL
                );
                INSERT INTO schema_version (version) VALUES (4);",
            )
            .map_err(|e| e.to_string())?;
        }

        if current < 5 {
            // Cached EXIF metadata so we don't reopen + re-parse the
            // source file on every detail-panel display or HD/full
            // image render. Invalidated by `(file_mtime, file_size)`
            // changing — same coarse check the on-disk image caches
            // use.
            conn.execute_batch(
                "CREATE TABLE photo_exif (
                    path        TEXT PRIMARY KEY,
                    file_mtime  INTEGER NOT NULL,
                    file_size   INTEGER NOT NULL,
                    orientation INTEGER NOT NULL DEFAULT 1,
                    metadata    TEXT NOT NULL
                );
                INSERT INTO schema_version (version) VALUES (5);",
            )
            .map_err(|e| e.to_string())?;
        }

        if current < 6 {
            // Per-photo star rating (0..=5) and color label
            // (`green`/`blue`/`yellow`/`orange`/`red` or empty).
            // Keyed by primary file path. A `rating = 0` and empty
            // `label` row is equivalent to "no rating row" — the
            // command layer deletes such rows.
            conn.execute_batch(
                "CREATE TABLE photo_ratings (
                    path   TEXT PRIMARY KEY,
                    rating INTEGER NOT NULL DEFAULT 0,
                    label  TEXT NOT NULL DEFAULT ''
                );
                INSERT INTO schema_version (version) VALUES (6);",
            )
            .map_err(|e| e.to_string())?;
        }

        if current < 7 {
            // Track when the user last rated/labelled a photo.
            // Stored as Unix epoch seconds; 0 for legacy rows that
            // pre-date this column.
            conn.execute_batch(
                "ALTER TABLE photo_ratings
                    ADD COLUMN rated_at INTEGER NOT NULL DEFAULT 0;
                INSERT INTO schema_version (version) VALUES (7);",
            )
            .map_err(|e| e.to_string())?;
        }

        if current < 8 {
            migrate_to_v8(&mut conn)?;
        }

        Ok(())
    }

    /// Return every persisted (path, rating, label, rated_at) row.
    pub fn all_photo_ratings(&self) -> Result<Vec<(String, i64, String, i64)>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT path, rating, label, rated_at FROM photo_ratings")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn set_photo_rating_row(
        &self,
        path: &str,
        rating: i64,
        label: &str,
        rated_at: i64,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO photo_ratings (path, rating, label, rated_at)
                 VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(path) DO UPDATE SET
                 rating   = excluded.rating,
                 label    = excluded.label,
                 rated_at = excluded.rated_at",
            params![path, rating, label, rated_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_photo_rating(&self, path: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM photo_ratings WHERE path = ?1", params![path])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Read a cached EXIF row (if any) along with the file fingerprint
    /// it was captured for.
    pub fn get_photo_exif(&self, path: &str) -> Result<Option<(i64, i64, u32, String)>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let row = conn
            .query_row(
                "SELECT file_mtime, file_size, orientation, metadata
                   FROM photo_exif WHERE path = ?1",
                params![path],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)? as u32,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other.to_string()),
            })?;
        Ok(row)
    }

    /// Upsert the EXIF cache row for `path`. `metadata_json` is the
    /// serialized [`crate::imaging::exif::ExifMetadata`].
    pub fn set_photo_exif(
        &self,
        path: &str,
        file_mtime: i64,
        file_size: i64,
        orientation: u32,
        metadata_json: &str,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO photo_exif (path, file_mtime, file_size, orientation, metadata)
                 VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(path) DO UPDATE SET
                 file_mtime  = excluded.file_mtime,
                 file_size   = excluded.file_size,
                 orientation = excluded.orientation,
                 metadata    = excluded.metadata",
            params![
                path,
                file_mtime,
                file_size,
                orientation as i64,
                metadata_json
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Return every persisted (path → edits-json) row.
    pub fn all_photo_edits(&self) -> Result<Vec<(String, String)>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT path, edits FROM photo_edits")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn set_photo_edit(&self, path: &str, edits_json: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO photo_edits (path, edits) VALUES (?1, ?2)
             ON CONFLICT(path) DO UPDATE SET edits = excluded.edits",
            params![path, edits_json],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_photo_edit(&self, path: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM photo_edits WHERE path = ?1", params![path])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Return every persisted (path → format, variant) override.
    pub fn all_photo_variants(&self) -> Result<Vec<(String, String, String)>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT path, format, variant FROM photo_variants")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    /// Upsert the chosen (format, variant) for a photo (keyed by its
    /// primary file path).
    pub fn set_photo_variant(&self, path: &str, format: &str, variant: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO photo_variants (path, format, variant) VALUES (?1, ?2, ?3)
             ON CONFLICT(path) DO UPDATE SET format = excluded.format, variant = excluded.variant",
            params![path, format, variant],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn add_media_root(&self, id: &str, name: &str) -> Result<MediaRoot, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        conn.execute(
            "INSERT INTO media_roots (id, name, added_at) VALUES (?1, ?2, ?3)",
            params![id, name, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(MediaRoot {
            id: id.to_string(),
            name: name.to_string(),
        })
    }

    pub fn media_roots(&self) -> Result<Vec<MediaRoot>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, name FROM media_roots ORDER BY added_at ASC, id ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(MediaRoot {
                    id: row.get(0)?,
                    name: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    /// Forget an imported media root and metadata keyed beneath it. Image
    /// files are deliberately untouched; this only changes the library DB.
    pub fn remove_media_root(&self, root_id: &str) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let prefix = format!("{root_id}/%");
        for table in [
            "photo_variants",
            "photo_edits",
            "photo_exif",
            "photo_ratings",
            "photo_effects",
        ] {
            // Some older libraries may not have every optional table yet.
            let sql = format!("DELETE FROM {table} WHERE path = ?1 OR path LIKE ?2");
            if let Err(error) = tx.execute(&sql, params![root_id, prefix]) {
                if !matches!(
                    error,
                    rusqlite::Error::SqliteFailure(_, Some(ref msg))
                        if msg.contains("no such table")
                ) {
                    return Err(error.to_string());
                }
            }
        }
        tx.execute("DELETE FROM media_roots WHERE id = ?1", params![root_id])
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }

    /// Replace separately imported child roots with one parent root while
    /// preserving every piece of photo metadata under its new portable key.
    /// Each rewrite is `(old_root_id, path_from_new_parent_to_old_root)`.
    pub fn consolidate_media_roots(
        &self,
        new_root_id: &str,
        new_name: &str,
        rewrites: &[(String, String)],
    ) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        for table in ["photo_variants", "photo_edits", "photo_exif", "photo_ratings"] {
            rewrite_root_paths(&tx, table, new_root_id, rewrites)?;
        }
        rewrite_root_settings(&tx, new_root_id, rewrites)?;

        for (old_root_id, _) in rewrites {
            tx.execute("DELETE FROM media_roots WHERE id = ?1", params![old_root_id])
                .map_err(|e| e.to_string())?;
        }
        tx.execute(
            "INSERT INTO media_roots (id, name, added_at) VALUES (?1, ?2, ?3)",
            params![new_root_id, new_name, now],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn library_id(&self) -> Result<String, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row("SELECT id FROM library_info LIMIT 1", [], |row| row.get(0))
            .map_err(|e| e.to_string())
    }

    /// Legacy absolute paths exist only in this local migration hand-off
    /// table. The loader persists them in device storage and then clears it,
    /// ensuring snapshots never expose host paths.
    pub fn legacy_root_bindings(&self) -> Result<Vec<(String, String)>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT root_id, absolute_path FROM migration_legacy_bindings")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn clear_legacy_root_bindings(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM migration_legacy_bindings", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Read a single key from the `app_settings` table. Returns `None`
    /// if the row is absent.
    pub fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let value: Option<String> = conn
            .query_row(
                "SELECT value FROM app_settings WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other.to_string()),
            })?;
        Ok(value)
    }

    /// Upsert a key/value setting. Stored values are opaque to the DB —
    /// callers typically serialize structured data as JSON.
    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_setting(&self, key: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM app_settings WHERE key = ?1", params![key])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Write a clean, defragmented copy of the live database to `dest`
    /// using SQLite's `VACUUM INTO`. Safe to call while the source DB
    /// is open and being read/written; produces a single self-contained
    /// file at `dest` (no WAL/SHM sidecars). The destination must not
    /// already exist.
    pub fn vacuum_into(&self, dest: &Path) -> Result<(), String> {
        let dest_str = dest
            .to_str()
            .ok_or_else(|| "destination path is not valid UTF-8".to_string())?;
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        // `VACUUM INTO` does not accept bound parameters; quote the
        // path by doubling single quotes (SQLite identifier rule).
        let quoted = dest_str.replace('\'', "''");
        conn.execute_batch(&format!("VACUUM INTO '{quoted}'"))
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

fn rewrite_root_paths(
    tx: &rusqlite::Transaction<'_>,
    table: &str,
    new_root_id: &str,
    rewrites: &[(String, String)],
) -> Result<(), String> {
    for (old_root_id, relative_prefix) in rewrites {
        let like = format!("{old_root_id}/%");
        let paths: Vec<String> = {
            let mut stmt = tx
                .prepare(&format!(
                    "SELECT path FROM {table} WHERE path = ?1 OR path LIKE ?2"
                ))
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![old_root_id, like], |row| row.get(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        for old_path in paths {
            let new_path = remap_root_path(
                &old_path,
                old_root_id,
                new_root_id,
                relative_prefix,
            )?;
            tx.execute(
                &format!("UPDATE {table} SET path = ?1 WHERE path = ?2"),
                params![new_path, old_path],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn rewrite_root_settings(
    tx: &rusqlite::Transaction<'_>,
    new_root_id: &str,
    rewrites: &[(String, String)],
) -> Result<(), String> {
    if let Some(path) = read_setting(tx, "last_folder")? {
        if let Some(mapped) = remap_from_any_root(&path, new_root_id, rewrites)? {
            write_setting(tx, "last_folder", &mapped)?;
        }
    }
    if let Some(raw) = read_setting(tx, "app_view")? {
        let mut value: serde_json::Value =
            serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        if let Some(path) = value.get("path").and_then(|entry| entry.as_str()) {
            if let Some(mapped) = remap_from_any_root(path, new_root_id, rewrites)? {
                value["path"] = serde_json::Value::String(mapped);
                write_setting(
                    tx,
                    "app_view",
                    &serde_json::to_string(&value).map_err(|e| e.to_string())?,
                )?;
            }
        }
    }
    if let Some(raw) = read_setting(tx, "photo_effects_v1")? {
        let value: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        let object = value
            .as_object()
            .ok_or_else(|| "photo_effects_v1 is not a JSON object".to_string())?;
        let mut migrated = serde_json::Map::new();
        for (path, effects) in object {
            let mapped = remap_from_any_root(path, new_root_id, rewrites)?
                .unwrap_or_else(|| path.clone());
            migrated.insert(mapped, effects.clone());
        }
        write_setting(
            tx,
            "photo_effects_v1",
            &serde_json::to_string(&migrated).map_err(|e| e.to_string())?,
        )?;
    }
    Ok(())
}

fn remap_from_any_root(
    path: &str,
    new_root_id: &str,
    rewrites: &[(String, String)],
) -> Result<Option<String>, String> {
    for (old_root_id, relative_prefix) in rewrites {
        if path == old_root_id || path.starts_with(&format!("{old_root_id}/")) {
            return remap_root_path(path, old_root_id, new_root_id, relative_prefix).map(Some);
        }
    }
    Ok(None)
}

fn remap_root_path(
    path: &str,
    old_root_id: &str,
    new_root_id: &str,
    relative_prefix: &str,
) -> Result<String, String> {
    let suffix = path
        .strip_prefix(old_root_id)
        .and_then(|value| value.strip_prefix('/').or(Some(value)))
        .ok_or_else(|| format!("path {path} is not under media root {old_root_id}"))?;
    Ok([new_root_id, relative_prefix, suffix]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("/"))
}

#[derive(Clone)]
struct LegacyRoot {
    id: String,
    path: std::path::PathBuf,
}

fn migrate_to_v8(conn: &mut Connection) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute_batch(
        "CREATE TABLE library_info (
            id       TEXT PRIMARY KEY,
            revision INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE media_roots (
            id       TEXT PRIMARY KEY,
            name     TEXT NOT NULL,
            added_at INTEGER NOT NULL
        );
        CREATE TABLE migration_legacy_bindings (
            root_id       TEXT PRIMARY KEY,
            absolute_path TEXT NOT NULL
        );",
    )
    .map_err(|e| e.to_string())?;

    let library_id = uuid::Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO library_info (id, revision) VALUES (?1, 1)",
        params![library_id],
    )
    .map_err(|e| e.to_string())?;

    let legacy_rows: Vec<(String, i64)> = {
        let mut stmt = tx
            .prepare("SELECT path, imported_at FROM imported_folders ORDER BY imported_at ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    let mut roots = Vec::new();
    for (absolute, added_at) in legacy_rows {
        let path = std::path::PathBuf::from(&absolute);
        let id = uuid::Uuid::new_v4().to_string();
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .unwrap_or("Photos");
        tx.execute(
            "INSERT INTO media_roots (id, name, added_at) VALUES (?1, ?2, ?3)",
            params![id, name, added_at],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO migration_legacy_bindings (root_id, absolute_path) VALUES (?1, ?2)",
            params![id, absolute],
        )
        .map_err(|e| e.to_string())?;
        roots.push(LegacyRoot { id, path });
    }
    // Longest match wins if an old library contains overlapping roots.
    roots.sort_by(|a, b| {
        b.path
            .components()
            .count()
            .cmp(&a.path.components().count())
    });

    for table in ["photo_variants", "photo_edits", "photo_ratings"] {
        rewrite_path_column(&tx, table, &roots)?;
    }
    // EXIF is a disposable cache and its file fingerprints are device-specific.
    tx.execute("DELETE FROM photo_exif", [])
        .map_err(|e| e.to_string())?;

    if let Some(path) = read_setting(&tx, "last_folder")? {
        let portable = legacy_path_to_key(&path, &roots)?;
        write_setting(&tx, "last_folder", &portable)?;
    }
    if let Some(raw) = read_setting(&tx, "app_view")? {
        let mut value: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        if let Some(path) = value.get("path").and_then(|value| value.as_str()) {
            let portable = legacy_path_to_key(path, &roots)?;
            value["path"] = serde_json::Value::String(portable);
        }
        write_setting(
            &tx,
            "app_view",
            &serde_json::to_string(&value).map_err(|e| e.to_string())?,
        )?;
    }
    if let Some(raw) = read_setting(&tx, "photo_effects_v1")? {
        let value: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        let object = value
            .as_object()
            .ok_or_else(|| "photo_effects_v1 is not a JSON object".to_string())?;
        let mut migrated = serde_json::Map::new();
        for (path, effects) in object {
            migrated.insert(legacy_path_to_key(path, &roots)?, effects.clone());
        }
        write_setting(
            &tx,
            "photo_effects_v1",
            &serde_json::to_string(&migrated).map_err(|e| e.to_string())?,
        )?;
    }

    // This value used to leak a device path into the shared library.
    tx.execute(
        "DELETE FROM app_settings WHERE key = 'last_library_path'",
        [],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DROP TABLE imported_folders", [])
        .map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO schema_version (version) VALUES (8)", [])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

fn rewrite_path_column(
    tx: &rusqlite::Transaction<'_>,
    table: &str,
    roots: &[LegacyRoot],
) -> Result<(), String> {
    let paths: Vec<String> = {
        let mut stmt = tx
            .prepare(&format!("SELECT path FROM {table}"))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };
    for old in paths {
        let new = legacy_path_to_key(&old, roots)?;
        tx.execute(
            &format!("UPDATE {table} SET path = ?1 WHERE path = ?2"),
            params![new, old],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn legacy_path_to_key(path: &str, roots: &[LegacyRoot]) -> Result<String, String> {
    let path = std::path::Path::new(path);
    for root in roots {
        if let Ok(relative) = path.strip_prefix(&root.path) {
            return super::portable_path::make_portable_key(&root.id, relative);
        }
    }
    Err(format!(
        "cannot migrate path outside all imported roots: {}",
        path.display()
    ))
}

fn read_setting(tx: &rusqlite::Transaction<'_>, key: &str) -> Result<Option<String>, String> {
    tx.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(other.to_string()),
    })
}

fn write_setting(tx: &rusqlite::Transaction<'_>, key: &str, value: &str) -> Result<(), String> {
    tx.execute(
        "UPDATE app_settings SET value = ?1 WHERE key = ?2",
        params![value, key],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_legacy_absolute_paths_to_portable_keys() {
        let dir = std::env::temp_dir().join(format!("warble-migration-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("legacy.warble");
        let root = dir.join("Photos");
        let photo = root.join("Trip").join("image.jpg");
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch(
            "CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
             INSERT INTO schema_version VALUES (7);
             CREATE TABLE imported_folders (path TEXT PRIMARY KEY, imported_at INTEGER NOT NULL);
             CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE photo_variants (path TEXT PRIMARY KEY, format TEXT NOT NULL, variant TEXT NOT NULL);
             CREATE TABLE photo_edits (path TEXT PRIMARY KEY, edits TEXT NOT NULL);
             CREATE TABLE photo_exif (path TEXT PRIMARY KEY, file_mtime INTEGER NOT NULL, file_size INTEGER NOT NULL, orientation INTEGER NOT NULL DEFAULT 1, metadata TEXT NOT NULL);
             CREATE TABLE photo_ratings (path TEXT PRIMARY KEY, rating INTEGER NOT NULL DEFAULT 0, label TEXT NOT NULL DEFAULT '', rated_at INTEGER NOT NULL DEFAULT 0);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO imported_folders VALUES (?1, 1)",
            params![root.to_string_lossy()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO photo_ratings VALUES (?1, 5, 'green', 2)",
            params![photo.to_string_lossy()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO app_settings VALUES ('last_folder', ?1)",
            params![root.join("Trip").to_string_lossy()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO app_settings VALUES ('photo_effects_v1', ?1)",
            params![format!(
                "{{\"{}\":{{\"grain\":null}}}}",
                photo.to_string_lossy()
            )],
        )
        .unwrap();
        drop(conn);

        let repo = LibraryRepository::open(&db).unwrap();
        let root_id = repo.media_roots().unwrap()[0].id.clone();
        let key = format!("{root_id}/Trip/image.jpg");
        assert_eq!(repo.all_photo_ratings().unwrap()[0].0, key);
        assert_eq!(
            repo.get_setting("last_folder").unwrap().unwrap(),
            format!("{root_id}/Trip")
        );
        assert!(repo
            .get_setting("photo_effects_v1")
            .unwrap()
            .unwrap()
            .contains(&key));
        assert_eq!(
            repo.legacy_root_bindings().unwrap()[0].1,
            root.to_string_lossy()
        );
        assert_eq!(repo.get_photo_exif(&key).unwrap(), None);

        drop(repo);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn consolidates_child_roots_without_losing_metadata() {
        let dir = std::env::temp_dir().join(format!(
            "warble-consolidate-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("library.warble");
        let repo = LibraryRepository::open(&db).unwrap();
        repo.add_media_root("child-a", "A").unwrap();
        repo.add_media_root("child-b", "B").unwrap();
        repo.set_photo_variant("child-a/trip.jpg", "jpg", "base")
            .unwrap();
        repo.set_photo_rating_row("child-b/portrait.jpg", 5, "green", 2)
            .unwrap();
        repo.set_setting("last_folder", "child-a").unwrap();
        repo.set_setting(
            "app_view",
            r#"{"path":"child-b/portrait.jpg","view":"full"}"#,
        )
        .unwrap();
        repo.set_setting(
            "photo_effects_v1",
            r#"{"child-a/trip.jpg":{"grain":null}}"#,
        )
        .unwrap();

        repo.consolidate_media_roots(
            "parent",
            "Pictures",
            &[
                ("child-a".to_string(), "A".to_string()),
                ("child-b".to_string(), "B".to_string()),
            ],
        )
        .unwrap();

        let roots = repo.media_roots().unwrap();
        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].id, "parent");
        assert_eq!(
            repo.all_photo_variants().unwrap()[0].0,
            "parent/A/trip.jpg"
        );
        assert_eq!(
            repo.all_photo_ratings().unwrap()[0].0,
            "parent/B/portrait.jpg"
        );
        assert_eq!(repo.get_setting("last_folder").unwrap().unwrap(), "parent/A");
        assert!(repo
            .get_setting("app_view")
            .unwrap()
            .unwrap()
            .contains("parent/B/portrait.jpg"));
        assert!(repo
            .get_setting("photo_effects_v1")
            .unwrap()
            .unwrap()
            .contains("parent/A/trip.jpg"));

        drop(repo);
        let _ = std::fs::remove_dir_all(dir);
    }
}

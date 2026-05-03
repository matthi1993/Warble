//! SQLite-backed persistence for the library (imported folder roots).
//!
//! The database stores only metadata — image files themselves stay on disk
//! and are referenced by absolute path.

use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};

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
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

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
        conn.execute(
            "DELETE FROM photo_ratings WHERE path = ?1",
            params![path],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Read a cached EXIF row (if any) along with the file fingerprint
    /// it was captured for.
    pub fn get_photo_exif(
        &self,
        path: &str,
    ) -> Result<Option<(i64, i64, u32, String)>, String> {
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
            params![path, file_mtime, file_size, orientation as i64, metadata_json],
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

    pub fn get_photo_edit(&self, path: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let value: Option<String> = conn
            .query_row(
                "SELECT edits FROM photo_edits WHERE path = ?1",
                params![path],
                |row| row.get(0),
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other.to_string()),
            })?;
        Ok(value)
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
        conn.execute(
            "DELETE FROM photo_edits WHERE path = ?1",
            params![path],
        )
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
    pub fn set_photo_variant(
        &self,
        path: &str,
        format: &str,
        variant: &str,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO photo_variants (path, format, variant) VALUES (?1, ?2, ?3)
             ON CONFLICT(path) DO UPDATE SET format = excluded.format, variant = excluded.variant",
            params![path, format, variant],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn record_imported_root(&self, path: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        conn.execute(
            "INSERT INTO imported_folders (path, imported_at) VALUES (?1, ?2)
             ON CONFLICT(path) DO UPDATE SET imported_at = excluded.imported_at",
            params![path, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn imported_root_paths(&self) -> Result<Vec<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT path FROM imported_folders ORDER BY imported_at ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
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
}

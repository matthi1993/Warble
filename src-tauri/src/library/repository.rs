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

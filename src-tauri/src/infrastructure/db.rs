//! SQLite-backed persistence for imported folders and (later) edits/ratings.
//!
//! The database stores only metadata — image files themselves stay on disk
//! and are referenced by absolute path.

use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};

pub struct Database {
    conn: Mutex<Connection>,
}

#[derive(Debug, Clone)]
pub struct ImportedFolderRow {
    pub path: String,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.migrate()?;
        Ok(db)
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

        // Migration 1: imported folder roots picked by the user.
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

        Ok(())
    }

    pub fn add_imported_folder(&self, path: &str) -> Result<(), String> {
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

    pub fn list_imported_folders(&self) -> Result<Vec<ImportedFolderRow>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT path FROM imported_folders ORDER BY imported_at ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| Ok(ImportedFolderRow { path: row.get(0)? }))
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }
}


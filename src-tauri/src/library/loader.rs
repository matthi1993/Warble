use crate::app_state;
use crate::imaging;

use tauri::Manager;
use app_state::AppState;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use crate::menu;
use crate::tasks;

use imaging::{exif_cache, full_image, hd_image, thumbnails};
use crate::library::LibraryRepository;

/// Canonical on-disk location of the active library database.
pub fn library_db_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .picture_dir()
        .ok()
        .map(|mut p| {
            p.push("library.warble");
            p
        })
        .unwrap_or_else(|| PathBuf::from("./library.warble"))
}

/// DB setting key for the last loaded library path.
const LAST_LIBRARY_KEY: &str = "last_library_path";

pub fn init_library_repository(app: &tauri::App) {
    let db_path = library_db_path(app.handle());
    if let Some(parent) = db_path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            eprintln!("failed to create library dir at {parent:?}: {e}");
        }
    }

    // On startup, check whether the user previously loaded a different
    // library file. If the saved path still exists and differs from
    // the active DB, copy it in before opening the repository.
    restore_last_library(&db_path);

    let state = app.state::<AppState>();
    match LibraryRepository::open(&db_path) {
        Ok(repo) => {
            let arc = Arc::new(repo);
            rehydrate_imported_roots(arc.as_ref(), &state);
            exif_cache::init(Arc::clone(&arc));
            {
                let mut guard = state.repository.lock().expect("repository mutex poisoned");
                *guard = Some(arc);
            }
        }
        Err(e) => eprintln!("failed to open library repository at {db_path:?}: {e}"),
    }
}

/// If the active DB has a `last_library_path` setting pointing to an
/// existing file different from the active DB, copy that file over
/// the active DB. If the file is gone, clear the setting.
fn restore_last_library(db_path: &Path) {
    if !db_path.exists() {
        return;
    }
    let conn = match rusqlite::Connection::open(db_path) {
        Ok(c) => c,
        Err(_) => return,
    };
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    );
    let saved: Option<String> = match conn.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        rusqlite::params![LAST_LIBRARY_KEY],
        |row| row.get::<_, String>(0),
    ) {
        Ok(v) => Some(v),
        Err(rusqlite::Error::QueryReturnedNoRows) => None,
        Err(_) => None,
    };
    drop(conn);

    let Some(saved_path) = saved else { return };
    let source = PathBuf::from(&saved_path);

    if same_file(&source, db_path) {
        return;
    }

    if !source.is_file() {
        eprintln!(
            "last library file no longer exists: {} — starting with existing library",
            source.display()
        );
        clear_last_library_setting(db_path);
        return;
    }

    remove_sqlite_sidecars(db_path);
    if let Err(e) = std::fs::copy(&source, db_path) {
        eprintln!(
            "failed to restore last library from {}: {e} — using existing DB",
            source.display()
        );
    } else {
        eprintln!("restored last library from {}", source.display());
    }
}

fn clear_last_library_setting(db_path: &Path) {
    let Ok(conn) = rusqlite::Connection::open(db_path) else {
        return;
    };
    let _ = conn.execute(
        "DELETE FROM app_settings WHERE key = ?1",
        rusqlite::params![LAST_LIBRARY_KEY],
    );
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

fn remove_sqlite_sidecars(db_path: &Path) {
    for suffix in ["-wal", "-shm", "-journal"] {
        let mut p = db_path.as_os_str().to_owned();
        p.push(suffix);
        let _ = std::fs::remove_file(PathBuf::from(p));
    }
}

pub fn init_thumbnail_cache(app: &tauri::App) {
    if let Ok(mut dir) = app.path().app_cache_dir() {
        dir.push("thumbnails");
        let _ = std::fs::create_dir_all(&dir);
        thumbnails::init_cache_dir(dir);
    }
}

pub fn init_hd_image_cache(app: &tauri::App) {
    if let Ok(mut dir) = app.path().app_cache_dir() {
        dir.push("hd_images");
        let _ = std::fs::create_dir_all(&dir);
        hd_image::init_cache_dir(dir);
    }
}

pub fn init_settings_and_caches(app: &tauri::App) {
    let state = app.state::<AppState>();
    if let Ok(repo) = state.repository() {
        state.settings.load_from(repo.as_ref());
    }
    let s = state.settings.get();
    thumbnails::set_disk_cache_max_entries(s.thumbnail_disk_max_entries);
    hd_image::set_disk_cache_max_entries(s.hd_image_disk_max_entries);
    full_image::set_memory_cache_capacity(s.full_image_memory_max_entries);
    tasks::pool().set_bg_concurrency(s.background_pool_workers);
}

pub fn init_menu(app: &tauri::App) {
    match menu::build(app.handle()) {
        Ok(m) => {
            if let Err(e) = app.set_menu(m) {
                eprintln!("failed to install application menu: {e}");
            }
        }
        Err(e) => eprintln!("failed to build application menu: {e}"),
    }
}

fn rehydrate_imported_roots(repo: &LibraryRepository, state: &AppState) {
    let Ok(paths) = repo.imported_root_paths() else {
        return;
    };
    let Ok(mut catalog) = state.catalog.lock() else {
        return;
    };
    for path in paths {
        let _ = catalog.rehydrate_root(&PathBuf::from(path));
    }
}

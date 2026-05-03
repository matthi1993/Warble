//! User-facing cache configuration, persisted in the SQLite library DB
//! (table `app_settings`, single JSON-encoded row keyed by
//! `cache_settings`).
//!
//! The frontend reads the current values at startup via `get_cache_settings`
//! and listens for `cache-settings-changed` events to react to menu-driven
//! changes at runtime.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::library::LibraryRepository;

/// DB row key used by [`SettingsStore`]. Bumped only if the schema of the
/// stored JSON changes incompatibly.
const SETTINGS_KEY: &str = "cache_settings";

/// Default ~10k thumbnail JPEGs at ~50KB each ≈ 500 MB on disk.
pub const DEFAULT_THUMB_CACHE_MAX: usize = 10_000;
/// Default ~2k HD JPEGs (1920px long side) at ~300KB each ≈ 600 MB on disk.
pub const DEFAULT_HD_CACHE_MAX: usize = 2_000;
/// Encoded full-resolution bytes held in process memory. ~5–20 MB each.
pub const DEFAULT_FULL_MEM_CACHE_MAX: usize = 8;
/// Decoded `ImageBitmap`s pinned in the renderer (frontend). A 24 MP RGBA
/// bitmap pins ~96 MB, so keep this small.
pub const DEFAULT_FULL_BITMAP_CACHE_MAX: usize = 4;

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct CacheSettings {
    pub thumbnail_disk_max_entries: usize,
    pub hd_image_disk_max_entries: usize,
    pub full_image_memory_max_entries: usize,
    pub full_image_bitmap_max_entries: usize,
}

impl Default for CacheSettings {
    fn default() -> Self {
        Self {
            thumbnail_disk_max_entries: DEFAULT_THUMB_CACHE_MAX,
            hd_image_disk_max_entries: DEFAULT_HD_CACHE_MAX,
            full_image_memory_max_entries: DEFAULT_FULL_MEM_CACHE_MAX,
            full_image_bitmap_max_entries: DEFAULT_FULL_BITMAP_CACHE_MAX,
        }
    }
}

#[derive(Default)]
pub struct SettingsStore {
    current: Mutex<CacheSettings>,
}

impl SettingsStore {
    /// Hydrate the in-memory snapshot from the DB. Falls back to defaults
    /// on any read or parse error.
    pub fn load_from(&self, repo: &LibraryRepository) {
        let parsed = repo
            .get_setting(SETTINGS_KEY)
            .ok()
            .flatten()
            .and_then(|raw| serde_json::from_str::<CacheSettings>(&raw).ok())
            .unwrap_or_default();
        if let Ok(mut c) = self.current.lock() {
            *c = parsed;
        }
    }

    pub fn get(&self) -> CacheSettings {
        self.current.lock().map(|c| *c).unwrap_or_default()
    }

    /// Update settings via `mutator` and persist to the DB. The new
    /// snapshot is returned regardless of whether the DB write succeeded
    /// (we still honour the change for the running session).
    pub fn update<F: FnOnce(&mut CacheSettings)>(
        &self,
        repo: &LibraryRepository,
        mutator: F,
    ) -> CacheSettings {
        let snapshot = {
            let mut guard = self.current.lock().expect("settings lock poisoned");
            mutator(&mut *guard);
            *guard
        };
        if let Ok(json) = serde_json::to_string(&snapshot) {
            if let Err(e) = repo.set_setting(SETTINGS_KEY, &json) {
                eprintln!("failed to persist cache settings: {e}");
            }
        }
        snapshot
    }
}

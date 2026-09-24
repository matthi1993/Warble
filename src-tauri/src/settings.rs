//! User-facing cache configuration, persisted in device-local state.
//!
//! The frontend reads the current values at startup via `get_cache_settings`
//! and listens for `cache-settings-changed` events to react to menu-driven
//! changes at runtime.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::device_storage::DeviceStorage;

/// Disk caches are opt-in so a first launch does no persistent cache work.
pub const DEFAULT_THUMB_CACHE_MAX: usize = 0;
/// HD disk cache is also opt-in.
pub const DEFAULT_HD_CACHE_MAX: usize = 0;
/// Encoded full-resolution bytes held in process memory. ~5–20 MB each.
pub const DEFAULT_FULL_MEM_CACHE_MAX: usize = 0;
/// Decoded `ImageBitmap`s pinned in the renderer (frontend). A 24 MP RGBA
/// bitmap pins ~96 MB, so keep this small.
pub const DEFAULT_FULL_BITMAP_CACHE_MAX: usize = 1;

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct CacheSettings {
    pub thumbnail_disk_max_entries: usize,
    pub hd_image_disk_max_entries: usize,
    pub full_image_memory_max_entries: usize,
    pub full_image_bitmap_max_entries: usize,
    /// Upgrade the active 1920px preview to a full-resolution bitmap after
    /// the user pauses on a photo. This can use hundreds of MB on iPad.
    pub full_resolution_enabled: bool,
}

impl Default for CacheSettings {
    fn default() -> Self {
        Self {
            thumbnail_disk_max_entries: DEFAULT_THUMB_CACHE_MAX,
            hd_image_disk_max_entries: DEFAULT_HD_CACHE_MAX,
            full_image_memory_max_entries: DEFAULT_FULL_MEM_CACHE_MAX,
            full_image_bitmap_max_entries: DEFAULT_FULL_BITMAP_CACHE_MAX,
            full_resolution_enabled: false,
        }
    }
}

#[derive(Default)]
pub struct SettingsStore {
    current: Mutex<CacheSettings>,
}

impl SettingsStore {
    /// Hydrate the in-memory snapshot from this device. Falls back to defaults
    /// on any read or parse error.
    pub fn load_from(&self, storage: &DeviceStorage) {
        let parsed = storage.cache_settings().unwrap_or_default();
        if let Ok(mut c) = self.current.lock() {
            *c = parsed;
        }
    }

    pub fn get(&self) -> CacheSettings {
        self.current.lock().map(|c| *c).unwrap_or_default()
    }

    /// Update settings via `mutator` and persist on this device. The new
    /// snapshot is returned regardless of whether the DB write succeeded
    /// (we still honour the change for the running session).
    pub fn update<F: FnOnce(&mut CacheSettings)>(
        &self,
        storage: &DeviceStorage,
        mutator: F,
    ) -> CacheSettings {
        let snapshot = {
            let mut guard = self.current.lock().expect("settings lock poisoned");
            mutator(&mut *guard);
            *guard
        };
        if let Err(e) = storage.set_cache_settings(snapshot) {
            eprintln!("failed to persist device cache settings: {e}");
        }
        snapshot
    }

    pub fn save(
        &self,
        storage: &DeviceStorage,
        settings: CacheSettings,
    ) -> Result<CacheSettings, String> {
        let mut current = self.current.lock().map_err(|e| e.to_string())?;
        storage.set_cache_settings(settings)?;
        *current = settings;
        Ok(settings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_reports_unavailable_storage_without_changing_active_settings() {
        let settings = SettingsStore::default();
        let mut requested = CacheSettings::default();
        requested.thumbnail_disk_max_entries = 5_000;

        assert!(settings.save(&DeviceStorage::default(), requested).is_err());
        assert_eq!(settings.get().thumbnail_disk_max_entries, 0);
    }
}

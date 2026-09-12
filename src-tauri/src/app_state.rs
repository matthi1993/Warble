use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::device_storage::DeviceStorage;
use crate::library::{LibraryCatalog, LibraryRepository};
use crate::settings::SettingsStore;

#[derive(Default)]
pub struct AppState {
    pub catalog: Mutex<LibraryCatalog>,
    pub repository: Mutex<Option<Arc<LibraryRepository>>>,
    pub settings: SettingsStore,
    pub device_storage: DeviceStorage,
    active_library_id: Mutex<Option<String>>,
}

impl AppState {
    /// Returns a clone of the Arc<LibraryRepository> if one is set.
    /// Kept simple so every existing `state.repository()?.…` call
    /// continues to work without changes.
    pub fn repository(&self) -> Result<Arc<LibraryRepository>, String> {
        self.repository
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .ok_or_else(|| "library repository not initialised".to_string())
    }

    pub fn set_active_library_id(&self, id: String) {
        if let Ok(mut guard) = self.active_library_id.lock() {
            *guard = Some(id);
        }
    }

    pub fn active_library_id(&self) -> Result<String, String> {
        self.active_library_id
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .ok_or_else(|| "active library is not initialised".to_string())
    }

    /// Resolve an opaque portable photo/folder key through this device's
    /// binding for the active library.
    pub fn resolve_library_path(&self, key: &str) -> Result<PathBuf, String> {
        let (root_id, relative) = crate::library::split_portable_key(key)?;
        let library_id = self.active_library_id()?;
        let root = self
            .device_storage
            .bindings_for(&library_id)
            .remove(root_id)
            .ok_or_else(|| format!("media root {root_id} is not connected on this device"))?;
        let candidate = root.join(relative);

        // Existing files are canonicalised to prevent a symlink inside an
        // allowed root from escaping that root.
        let canonical_root = std::fs::canonicalize(&root)
            .map_err(|e| format!("media root {} is unavailable: {e}", root.display()))?;
        let canonical_candidate = std::fs::canonicalize(&candidate)
            .map_err(|e| format!("media file {} is unavailable: {e}", candidate.display()))?;
        if !canonical_candidate.starts_with(&canonical_root) {
            return Err("resolved media path escapes its bound root".to_string());
        }
        Ok(canonical_candidate)
    }
}

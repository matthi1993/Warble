use std::sync::{Arc, Mutex};

use crate::library::{LibraryCatalog, LibraryRepository};
use crate::settings::SettingsStore;

#[derive(Default)]
pub struct AppState {
    pub catalog: Mutex<LibraryCatalog>,
    pub repository: Mutex<Option<Arc<LibraryRepository>>>,
    pub settings: SettingsStore,
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

    /// Hot-swap the repository. Drops the old Arc (closing its
    /// SQLite connection when the last reference is gone) and
    /// installs a new one. Used by `load_library` to swap in a
    /// different library DB without restarting the app.
    pub fn swap_repository(&self, new: Arc<LibraryRepository>) {
        if let Ok(mut guard) = self.repository.lock() {
            *guard = Some(new);
        }
    }
}

use std::sync::{Arc, Mutex, OnceLock};

use crate::library::{LibraryCatalog, LibraryRepository};
use crate::settings::SettingsStore;

#[derive(Default)]
pub struct AppState {
    pub catalog: Mutex<LibraryCatalog>,
    pub repository: OnceLock<Arc<LibraryRepository>>,
    pub settings: SettingsStore,
}

impl AppState {
    pub fn repository(&self) -> Result<&LibraryRepository, String> {
        self.repository
            .get()
            .map(|a| a.as_ref())
            .ok_or_else(|| "library repository not initialised".to_string())
    }
}

use std::sync::{Mutex, OnceLock};

use crate::library::{LibraryCatalog, LibraryRepository};

#[derive(Default)]
pub struct AppState {
    pub catalog: Mutex<LibraryCatalog>,
    pub repository: OnceLock<LibraryRepository>,
}

impl AppState {
    pub fn repository(&self) -> Result<&LibraryRepository, String> {
        self.repository
            .get()
            .ok_or_else(|| "library repository not initialised".to_string())
    }
}

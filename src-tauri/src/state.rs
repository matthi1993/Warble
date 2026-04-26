use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use crate::domain::folders::Folder;
use crate::domain::photos::Photo;
use crate::infrastructure::db::Database;

#[derive(Default)]
pub struct AppStateInner {
    pub imported_folders: Vec<Folder>,
    pub photos: HashMap<String, Photo>,
}

#[derive(Default)]
pub struct AppState {
    pub inner: Mutex<AppStateInner>,
    pub db: OnceLock<Database>,
}

impl AppState {
    pub fn db(&self) -> Result<&Database, String> {
        self.db
            .get()
            .ok_or_else(|| "database not initialised".to_string())
    }
}

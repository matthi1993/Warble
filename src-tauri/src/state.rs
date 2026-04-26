use std::collections::HashMap;
use std::sync::Mutex;

use crate::domain::folders::Folder;
use crate::domain::photos::Photo;

#[derive(Default)]
pub struct AppStateInner {
    pub imported_folders: Vec<Folder>,
    pub photos: HashMap<String, Photo>,
}

#[derive(Default)]
pub struct AppState {
    pub inner: Mutex<AppStateInner>,
}

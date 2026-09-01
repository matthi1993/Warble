//! Device-only state. Nothing in this file is copied into a `.warble` file.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

#[derive(Default, Serialize, Deserialize)]
struct DeviceData {
    #[serde(default)]
    last_library_path: Option<String>,
    #[serde(default)]
    library_bookmark: Option<String>,
    #[serde(default)]
    root_bindings: HashMap<String, HashMap<String, String>>,
    #[serde(default)]
    root_bookmarks: HashMap<String, HashMap<String, String>>,
}

#[derive(Default)]
struct DeviceStorageInner {
    path: Option<PathBuf>,
    data: DeviceData,
}

#[derive(Default)]
pub struct DeviceStorage {
    inner: Mutex<DeviceStorageInner>,
}

impl DeviceStorage {
    pub fn init(&self, path: PathBuf) -> Result<(), String> {
        let data = match std::fs::read_to_string(&path) {
            Ok(raw) => serde_json::from_str(&raw)
                .map_err(|e| format!("invalid device state {}: {e}", path.display()))?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => DeviceData::default(),
            Err(e) => return Err(e.to_string()),
        };
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        inner.path = Some(path);
        inner.data = data;
        Ok(())
    }

    pub fn last_library_path(&self) -> Option<PathBuf> {
        self.inner
            .lock()
            .ok()?
            .data
            .last_library_path
            .as_deref()
            .map(PathBuf::from)
    }

    pub fn set_last_library_path(&self, path: Option<&Path>) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        inner.data.last_library_path = path.map(|p| p.to_string_lossy().into_owned());
        persist(&inner)
    }

    #[cfg_attr(not(target_os = "ios"), allow(dead_code))]
    pub fn library_bookmark(&self) -> Option<String> {
        self.inner.lock().ok()?.data.library_bookmark.clone()
    }

    pub fn set_library_bookmark(&self, bookmark: Option<&str>) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        inner.data.library_bookmark = bookmark.map(str::to_string);
        persist(&inner)
    }

    pub fn bindings_for(&self, library_id: &str) -> HashMap<String, PathBuf> {
        self.inner
            .lock()
            .ok()
            .and_then(|inner| inner.data.root_bindings.get(library_id).cloned())
            .unwrap_or_default()
            .into_iter()
            .map(|(id, path)| (id, PathBuf::from(path)))
            .collect()
    }

    pub fn set_root_binding(
        &self,
        library_id: &str,
        root_id: &str,
        path: &Path,
    ) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        inner
            .data
            .root_bindings
            .entry(library_id.to_string())
            .or_default()
            .insert(root_id.to_string(), path.to_string_lossy().into_owned());
        persist(&inner)
    }

    #[cfg_attr(not(target_os = "ios"), allow(dead_code))]
    pub fn root_bookmarks_for(&self, library_id: &str) -> HashMap<String, String> {
        self.inner
            .lock()
            .ok()
            .and_then(|inner| inner.data.root_bookmarks.get(library_id).cloned())
            .unwrap_or_default()
    }

    pub fn set_root_bookmark(
        &self,
        library_id: &str,
        root_id: &str,
        bookmark: &str,
    ) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        inner
            .data
            .root_bookmarks
            .entry(library_id.to_string())
            .or_default()
            .insert(root_id.to_string(), bookmark.to_string());
        persist(&inner)
    }
}

fn persist(inner: &DeviceStorageInner) -> Result<(), String> {
    let path = inner
        .path
        .as_ref()
        .ok_or_else(|| "device storage is not initialised".to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    let raw = serde_json::to_vec_pretty(&inner.data).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, raw).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

//! Device-only state. Nothing in this file is copied into a `.warble` file.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::settings::CacheSettings;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileFingerprint {
    pub size: u64,
    pub content_hash: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
struct RootGrant {
    path: String,
    #[serde(default)]
    bookmark: Option<String>,
}

#[derive(Default, Serialize, Deserialize)]
struct DeviceData {
    #[serde(default)]
    cache_settings: Option<CacheSettings>,
    #[serde(default)]
    last_library_path: Option<String>,
    #[serde(default)]
    library_bookmark: Option<String>,
    #[serde(default)]
    library_fingerprint: Option<FileFingerprint>,
    // Legacy v8 fields. They are migrated to `root_grants` when loaded.
    #[serde(default)]
    root_bindings: HashMap<String, HashMap<String, String>>,
    #[serde(default)]
    root_bookmarks: HashMap<String, HashMap<String, String>>,
    #[serde(default)]
    root_grants: HashMap<String, HashMap<String, Vec<RootGrant>>>,
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
        let mut data: DeviceData = match std::fs::read_to_string(&path) {
            Ok(raw) => serde_json::from_str(&raw)
                .map_err(|e| format!("invalid device state {}: {e}", path.display()))?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => DeviceData::default(),
            Err(e) => return Err(e.to_string()),
        };
        migrate_legacy_root_grants(&mut data);
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        inner.path = Some(path);
        inner.data = data;
        persist(&inner)
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

    pub fn cache_settings(&self) -> Option<CacheSettings> {
        self.inner.lock().ok()?.data.cache_settings
    }

    pub fn set_cache_settings(&self, settings: CacheSettings) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        inner.data.cache_settings = Some(settings);
        persist(&inner)
    }

    #[cfg_attr(not(target_os = "ios"), allow(dead_code))]
    pub fn library_bookmark(&self) -> Option<String> {
        self.inner.lock().ok()?.data.library_bookmark.clone()
    }

    pub fn library_fingerprint(&self) -> Option<FileFingerprint> {
        self.inner.lock().ok()?.data.library_fingerprint.clone()
    }

    pub fn set_library_source(
        &self,
        path: Option<&Path>,
        bookmark: Option<&str>,
        fingerprint: Option<FileFingerprint>,
    ) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        inner.data.last_library_path = path.map(|path| path.to_string_lossy().into_owned());
        inner.data.library_bookmark = bookmark.map(str::to_string);
        inner.data.library_fingerprint = fingerprint;
        persist(&inner)
    }

    pub fn bindings_for(&self, library_id: &str) -> HashMap<String, PathBuf> {
        self.inner
            .lock()
            .ok()
            .and_then(|inner| inner.data.root_grants.get(library_id).cloned())
            .unwrap_or_default()
            .into_iter()
            .filter_map(|(id, grants)| {
                let selected = grants
                    .iter()
                    .find(|grant| Path::new(&grant.path).is_dir())
                    .or_else(|| grants.first())?;
                Some((id, PathBuf::from(&selected.path)))
            })
            .collect()
    }

    pub fn set_root_binding(
        &self,
        library_id: &str,
        root_id: &str,
        path: &Path,
    ) -> Result<(), String> {
        self.set_root_grant(library_id, root_id, path, None)
    }

    pub fn set_root_grant(
        &self,
        library_id: &str,
        root_id: &str,
        path: &Path,
        bookmark: Option<&str>,
    ) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        let grants = inner
            .data
            .root_grants
            .entry(library_id.to_string())
            .or_default()
            .entry(root_id.to_string())
            .or_default();
        let path = path.to_string_lossy().into_owned();
        if let Some(index) = grants.iter().position(|grant| {
            grant.path == path || (bookmark.is_some() && grant.bookmark.as_deref() == bookmark)
        }) {
            let mut grant = grants.remove(index);
            grant.path = path;
            if bookmark.is_some() {
                grant.bookmark = bookmark.map(str::to_string);
            }
            grants.insert(0, grant);
        } else {
            grants.insert(
                0,
                RootGrant {
                    path,
                    bookmark: bookmark.map(str::to_string),
                },
            );
        }
        persist(&inner)
    }

    #[cfg_attr(not(target_os = "ios"), allow(dead_code))]
    pub fn refresh_root_grant(
        &self,
        library_id: &str,
        root_id: &str,
        previous_bookmark: &str,
        path: &Path,
        current_bookmark: &str,
    ) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        let grants = inner
            .data
            .root_grants
            .entry(library_id.to_string())
            .or_default()
            .entry(root_id.to_string())
            .or_default();
        if let Some(grant) = grants
            .iter_mut()
            .find(|grant| grant.bookmark.as_deref() == Some(previous_bookmark))
        {
            grant.path = path.to_string_lossy().into_owned();
            grant.bookmark = Some(current_bookmark.to_string());
        } else {
            grants.push(RootGrant {
                path: path.to_string_lossy().into_owned(),
                bookmark: Some(current_bookmark.to_string()),
            });
        }
        persist(&inner)
    }

    #[cfg_attr(not(target_os = "ios"), allow(dead_code))]
    pub fn root_bookmarks_for(&self, library_id: &str) -> Vec<(String, String)> {
        self.inner
            .lock()
            .ok()
            .and_then(|inner| inner.data.root_grants.get(library_id).cloned())
            .unwrap_or_default()
            .into_iter()
            .flat_map(|(root_id, grants)| {
                grants.into_iter().filter_map(move |grant| {
                    grant.bookmark.map(|bookmark| (root_id.clone(), bookmark))
                })
            })
            .collect()
    }

    pub fn remove_root(&self, library_id: &str, root_id: &str) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        if let Some(grants) = inner.data.root_grants.get_mut(library_id) {
            grants.remove(root_id);
        }
        persist(&inner)
    }

    /// Atomically replace several child-root grants with one parent grant.
    pub fn consolidate_roots(
        &self,
        library_id: &str,
        old_root_ids: &[String],
        new_root_id: &str,
        path: &Path,
        bookmark: Option<&str>,
    ) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        let grants_by_root = inner
            .data
            .root_grants
            .entry(library_id.to_string())
            .or_default();
        for old_root_id in old_root_ids {
            grants_by_root.remove(old_root_id);
        }
        grants_by_root.insert(
            new_root_id.to_string(),
            vec![RootGrant {
                path: path.to_string_lossy().into_owned(),
                bookmark: bookmark.map(str::to_string),
            }],
        );
        persist(&inner)
    }
}

fn migrate_legacy_root_grants(data: &mut DeviceData) {
    let bindings = std::mem::take(&mut data.root_bindings);
    let mut bookmarks = std::mem::take(&mut data.root_bookmarks);
    for (library_id, roots) in bindings {
        for (root_id, path) in roots {
            let bookmark = bookmarks
                .get_mut(&library_id)
                .and_then(|roots| roots.remove(&root_id));
            data.root_grants
                .entry(library_id.clone())
                .or_default()
                .entry(root_id)
                .or_default()
                .push(RootGrant { path, bookmark });
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    const LIBRARY: &str = "library-id";
    const ROOT: &str = "root-id";

    #[test]
    fn migrates_legacy_grant_and_selects_an_available_alternative() {
        let dir =
            std::env::temp_dir().join(format!("warble-device-storage-{}", uuid::Uuid::new_v4()));
        let first = dir.join("usb");
        let second = dir.join("smb");
        std::fs::create_dir_all(&first).unwrap();
        std::fs::create_dir_all(&second).unwrap();
        let state_path = dir.join("device-state.json");
        std::fs::write(
            &state_path,
            format!(
                r#"{{
                  "root_bindings": {{"{LIBRARY}": {{"{ROOT}": "{}"}}}},
                  "root_bookmarks": {{"{LIBRARY}": {{"{ROOT}": "usb-bookmark"}}}}
                }}"#,
                first.to_string_lossy()
            ),
        )
        .unwrap();

        let storage = DeviceStorage::default();
        storage.init(state_path).unwrap();
        storage
            .set_root_grant(LIBRARY, ROOT, &second, Some("smb-bookmark"))
            .unwrap();

        assert_eq!(storage.bindings_for(LIBRARY).get(ROOT), Some(&second));
        assert_eq!(storage.root_bookmarks_for(LIBRARY).len(), 2);

        std::fs::remove_dir(&second).unwrap();
        assert_eq!(storage.bindings_for(LIBRARY).get(ROOT), Some(&first));

        drop(storage);
        std::fs::remove_dir_all(dir).unwrap();
    }
}

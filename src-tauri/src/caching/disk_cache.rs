//! Generic on-disk byte cache.
//!
//! A `DiskCache` owns a root directory and stores arbitrary byte payloads
//! under hashed keys. Files are written atomically (temp file + rename) so
//! a crash or concurrent reader never sees a torn entry.
//!
//! Keys are built via `CacheKeyBuilder`, which hashes any `Hash`-able input
//! (including a source file's path + size + mtime) into a 64-bit digest.
//! Distinct callers should mix a stable discriminator (e.g. a pipeline
//! version) into their keys so cache entries don't collide across domains
//! or invalidate silently when the producing code changes.

use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub struct DiskCache {
    root: PathBuf,
    file_extension: &'static str,
}

impl DiskCache {
    /// Create a cache rooted at `root`. Stored entries get the file
    /// extension `file_extension` (e.g. `"jpg"`, `"bin"`).
    pub fn new(root: PathBuf, file_extension: &'static str) -> Self {
        Self {
            root,
            file_extension,
        }
    }

    pub fn get(&self, key: &CacheKey) -> Option<Vec<u8>> {
        fs::read(self.path_for(key)).ok()
    }

    pub fn put(&self, key: &CacheKey, bytes: &[u8]) {
        let target = self.path_for(key);
        let Some(parent) = target.parent() else { return };
        if fs::create_dir_all(parent).is_err() {
            return;
        }
        let tmp = parent.join(format!(
            ".{}.tmp",
            target
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("entry")
        ));
        let wrote = (|| -> std::io::Result<()> {
            let mut f = fs::File::create(&tmp)?;
            f.write_all(bytes)?;
            f.sync_data()?;
            Ok(())
        })();
        if wrote.is_ok() {
            let _ = fs::rename(&tmp, &target);
        } else {
            let _ = fs::remove_file(&tmp);
        }
    }

    fn path_for(&self, key: &CacheKey) -> PathBuf {
        // 2-char shard prefix keeps any single directory from blowing up.
        let hex = format!("{:016x}", key.digest);
        let shard = &hex[..2];
        let mut p = self.root.clone();
        p.push(shard);
        p.push(format!("{hex}.{}", self.file_extension));
        p
    }
}

#[derive(Clone, Copy)]
pub struct CacheKey {
    digest: u64,
}

pub struct CacheKeyBuilder {
    hasher: DefaultHasher,
}

impl CacheKeyBuilder {
    pub fn new() -> Self {
        Self {
            hasher: DefaultHasher::new(),
        }
    }

    /// Mix in any hashable component (a version number, parameter, label).
    pub fn with<H: Hash>(mut self, value: H) -> Self {
        value.hash(&mut self.hasher);
        self
    }

    /// Mix in a source file's identity: its path plus a content fingerprint
    /// (size + mtime in nanoseconds). The cache entry is automatically
    /// invalidated whenever the underlying file changes.
    pub fn with_source_file(mut self, path: &Path) -> Self {
        path.to_string_lossy().hash(&mut self.hasher);
        if let Ok(meta) = fs::metadata(path) {
            meta.len().hash(&mut self.hasher);
            let mtime_ns = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            mtime_ns.hash(&mut self.hasher);
        }
        self
    }

    pub fn build(self) -> CacheKey {
        CacheKey {
            digest: self.hasher.finish(),
        }
    }
}

impl Default for CacheKeyBuilder {
    fn default() -> Self {
        Self::new()
    }
}

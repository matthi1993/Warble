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
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// Run a full LRU sweep at most every N successful puts, to bound the
/// per-write cost while keeping overshoot small (~N entries above the cap).
const PUTS_PER_SWEEP: usize = 64;

pub struct DiskCache {
    root: PathBuf,
    file_extension: &'static str,
    /// 0 means "unbounded" (no eviction).
    max_entries: Mutex<usize>,
    puts_since_sweep: AtomicUsize,
}

impl DiskCache {
    /// Create a cache rooted at `root`. Stored entries get the file
    /// extension `file_extension` (e.g. `"jpg"`, `"bin"`). The cache is
    /// unbounded until `set_max_entries` is called.
    pub fn new(root: PathBuf, file_extension: &'static str) -> Self {
        Self {
            root,
            file_extension,
            max_entries: Mutex::new(0),
            puts_since_sweep: AtomicUsize::new(0),
        }
    }

    /// Update the count limit. `0` disables eviction. Triggers an immediate
    /// sweep so the new limit is enforced even if no further puts happen.
    pub fn set_max_entries(&self, max: usize) {
        if let Ok(mut guard) = self.max_entries.lock() {
            *guard = max;
        }
        self.enforce_limit();
    }

    pub fn max_entries(&self) -> usize {
        self.max_entries.lock().map(|g| *g).unwrap_or(0)
    }

    /// Filesystem location of this cache. Useful for surfacing the
    /// path to the user (e.g. in the macOS Cache menu) or for
    /// "Reveal in Finder".
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Walks the cache directory and returns `(total_bytes,
    /// file_count)` across every entry matching this cache's
    /// extension. Best-effort: unreadable shards are skipped.
    pub fn disk_usage(&self) -> (u64, usize) {
        let mut total: u64 = 0;
        let mut count: usize = 0;
        let Ok(shards) = fs::read_dir(&self.root) else {
            return (0, 0);
        };
        for shard in shards.flatten() {
            let shard_path = shard.path();
            if !shard_path.is_dir() {
                continue;
            }
            let Ok(files) = fs::read_dir(&shard_path) else {
                continue;
            };
            for file in files.flatten() {
                let path = file.path();
                let matches_ext = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.eq_ignore_ascii_case(self.file_extension))
                    .unwrap_or(false);
                if !matches_ext {
                    continue;
                }
                if let Ok(meta) = file.metadata() {
                    total = total.saturating_add(meta.len());
                    count += 1;
                }
            }
        }
        (total, count)
    }

    pub fn get(&self, key: &CacheKey) -> Option<Vec<u8>> {
        // Reading the file updates its atime on macOS APFS, which is
        // what `enforce_limit` uses as the recency signal for the LRU.
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
            // Periodically enforce the size limit. This bounds the
            // per-put cost: we only walk the cache directory tree once
            // every PUTS_PER_SWEEP writes.
            let n = self.puts_since_sweep.fetch_add(1, Ordering::Relaxed) + 1;
            if n >= PUTS_PER_SWEEP {
                self.puts_since_sweep.store(0, Ordering::Relaxed);
                self.enforce_limit();
            }
        } else {
            let _ = fs::remove_file(&tmp);
        }
    }

    /// Delete every cached entry. Best-effort; preserves the root dir.
    pub fn clear(&self) {
        let Ok(shards) = fs::read_dir(&self.root) else {
            return;
        };
        for shard in shards.flatten() {
            let p = shard.path();
            if p.is_dir() {
                let _ = fs::remove_dir_all(&p);
            } else {
                let _ = fs::remove_file(&p);
            }
        }
        self.puts_since_sweep.store(0, Ordering::Relaxed);
    }

    /// Walk every cache file, drop the oldest (by mtime) until the entry
    /// count is at or below `max_entries`. No-op when unbounded.
    pub fn enforce_limit(&self) {
        let cap = self.max_entries();
        if cap == 0 {
            return;
        }
        let mut entries: Vec<(SystemTime, PathBuf)> = Vec::new();
        collect_entries(&self.root, self.file_extension, &mut entries);
        if entries.len() <= cap {
            return;
        }
        // Oldest first.
        entries.sort_by(|a, b| a.0.cmp(&b.0));
        let to_remove = entries.len() - cap;
        for (_, p) in entries.into_iter().take(to_remove) {
            let _ = fs::remove_file(&p);
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

/// Walk shard subdirectories and collect (mtime, path) for every file
/// matching `extension`. Best-effort; unreadable entries are skipped.
fn collect_entries(root: &Path, extension: &str, out: &mut Vec<(SystemTime, PathBuf)>) {
    let Ok(shards) = fs::read_dir(root) else { return };
    for shard in shards.flatten() {
        let shard_path = shard.path();
        if !shard_path.is_dir() {
            continue;
        }
        let Ok(files) = fs::read_dir(&shard_path) else {
            continue;
        };
        for file in files.flatten() {
            let path = file.path();
            let matches_ext = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case(extension))
                .unwrap_or(false);
            if !matches_ext {
                continue;
            }
            let mtime = file
                .metadata()
                .map(|m| {
                    // Use the most recent of (modified, accessed) so a
                    // recent read protects an old entry. Falls back to
                    // UNIX_EPOCH if neither is available.
                    let modified = m.modified().unwrap_or(UNIX_EPOCH);
                    let accessed = m.accessed().unwrap_or(UNIX_EPOCH);
                    modified.max(accessed)
                })
                .unwrap_or(UNIX_EPOCH);
            out.push((mtime, path));
        }
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

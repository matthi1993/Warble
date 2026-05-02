//! Caching domain: persistent on-disk byte cache and in-process LRU.

mod disk_cache;
mod memory_lru;

pub use disk_cache::{CacheKeyBuilder, DiskCache};
pub use memory_lru::MemoryLru;

// Re-exported for callers that want to name the key type explicitly.
#[allow(unused_imports)]
pub use disk_cache::CacheKey;

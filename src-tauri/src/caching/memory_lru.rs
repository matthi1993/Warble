//! Tiny in-process LRU. Generic over the cached value type. Entries are
//! invalidated whenever the source file's mtime changes.

use std::collections::VecDeque;
use std::time::SystemTime;

struct Entry<V> {
    key: String,
    mtime: SystemTime,
    value: V,
}

pub struct MemoryLru<V: Clone> {
    capacity: usize,
    items: VecDeque<Entry<V>>,
}

impl<V: Clone> MemoryLru<V> {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity,
            items: VecDeque::with_capacity(capacity),
        }
    }

    pub fn get(&mut self, key: &str, mtime: SystemTime) -> Option<V> {
        let pos = self
            .items
            .iter()
            .position(|e| e.key == key && e.mtime == mtime)?;
        let entry = self.items.remove(pos)?;
        let value = entry.value.clone();
        self.items.push_front(entry);
        Some(value)
    }

    pub fn insert(&mut self, key: String, mtime: SystemTime, value: V) {
        if let Some(pos) = self.items.iter().position(|e| e.key == key) {
            self.items.remove(pos);
        }
        self.items.push_front(Entry { key, mtime, value });
        while self.items.len() > self.capacity {
            self.items.pop_back();
        }
    }
}

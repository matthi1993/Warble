//! Tauri commands exposing task pool diagnostics to the debug overlay.

use crate::tasks::{self, PoolStats};

#[tauri::command]
pub fn get_task_stats() -> PoolStats {
    tasks::pool().snapshot()
}

/// Cancel every queued and running job in the task pool. Returns the
/// number of tokens that were flipped. Surfaced from the debug
/// overlay's "Cancel All" button.
#[tauri::command]
pub fn cancel_all_tasks() -> usize {
    tasks::pool().cancel_all()
}

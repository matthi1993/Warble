//! Tauri commands exposing task pool diagnostics to the debug overlay.

use crate::tasks::{self, PoolStats};

#[tauri::command]
pub fn get_task_stats() -> PoolStats {
    tasks::pool().snapshot()
}

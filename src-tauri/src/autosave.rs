//! Debounced synchronization from the always-durable working SQLite database
//! to the user-selected `.warble` document.

use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::OnceLock;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use crate::app_state::AppState;

const AUTOSAVE_DEBOUNCE: Duration = Duration::from_secs(1);
static DIRTY_SENDER: OnceLock<Sender<String>> = OnceLock::new();

pub fn init(app: AppHandle) {
    let (sender, receiver) = mpsc::channel();
    if DIRTY_SENDER.set(sender).is_err() {
        return;
    }

    tauri::async_runtime::spawn_blocking(move || {
        while let Ok(mut library_id) = receiver.recv() {
            loop {
                match receiver.recv_timeout(AUTOSAVE_DEBOUNCE) {
                    Ok(newer_library_id) => library_id = newer_library_id,
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }

            let state = app.state::<AppState>();
            if state.active_library_id().ok().as_deref() != Some(library_id.as_str()) {
                continue;
            }

            match crate::commands::autosave_open_library(&app, &state, &library_id) {
                Ok(true) => {
                    let _ = app.emit("library-autosave-error", "");
                }
                Ok(false) => {}
                Err(error) => {
                    eprintln!("failed to autosave library: {error}");
                    let _ = app.emit("library-autosave-error", error);
                }
            }
        }
    });
}

pub fn mark_dirty(library_id: String) {
    if let Some(sender) = DIRTY_SENDER.get() {
        let _ = sender.send(library_id);
    }
}

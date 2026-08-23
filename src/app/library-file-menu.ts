//! Wires the macOS "File > Save/Load Library …" menu items to the
//! native file dialog and the matching Tauri commands.
//!
//! The Rust menu handler emits `library:save-requested` /
//! `library:load-requested` (see `src-tauri/src/menu/menu.rs`); this
//! module listens for those events, opens the platform save/open
//! dialog, and invokes the backend. After a successful load the Rust
//! command restarts the app, so we don't need to refresh any
//! frontend state here.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { message, open, save } from "@tauri-apps/plugin-dialog";

const LIBRARY_FILTER = {
    name: "Warble Library",
    extensions: ["warble"],
};

export function registerLibraryFileMenuHandlers(): void {
    void listen("library:save-requested", () => {
        void handleSaveRequested();
    });
    void listen("library:load-requested", () => {
        void handleLoadRequested();
    });
}

async function handleSaveRequested(): Promise<void> {
    let path: string | null;
    try {
        path = await save({
            title: "Save Library",
            defaultPath: "library.warble",
            filters: [LIBRARY_FILTER],
        });
    } catch (err) {
        console.error("save dialog failed:", err);
        return;
    }
    if (!path) return;
    try {
        await invoke("save_library", { path });
    } catch (err) {
        console.error("save_library failed:", err);
        void message(`Failed to save library: ${err}`, {
            title: "Save Library",
            kind: "error",
        });
    }
}

async function handleLoadRequested(): Promise<void> {
    let selection: string | string[] | null;
    try {
        selection = await open({
            title: "Load Library",
            multiple: false,
            directory: false,
            filters: [LIBRARY_FILTER],
        });
    } catch (err) {
        console.error("load dialog failed:", err);
        return;
    }
    const path = Array.isArray(selection) ? selection[0] : selection;
    if (!path) return;
    try {
        // Backend restarts the app on success; this call won't return
        // normally in that case.
        await invoke("load_library", { path });
    } catch (err) {
        // The backend returns an error string if the selected file
        // doesn't exist, can't be copied, or isn't a valid SQLite
        // database. Show it to the user; the old library is left
        // untouched so the app keeps working.
        console.error("load_library failed:", err);
        void message(`Failed to load library: ${err}`, {
            title: "Load Library",
            kind: "error",
        });
    }
}

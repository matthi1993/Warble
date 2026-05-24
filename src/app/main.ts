import "@ui/index";
import "./app-shell";
import { configureFullImageCacheFromSettings } from "./full-image-cache";
import { configureHdImageCacheFromSettings } from "./hd-image-cache";
import { loadPhotoEdits } from "@services/edits/edits-store";
import { registerLibraryFileMenuHandlers } from "./library-file-menu";

// Sync the in-memory ImageBitmap cache size with the persisted Tauri
// setting (and react to runtime changes from the macOS Cache menu).
void configureFullImageCacheFromSettings();
void configureHdImageCacheFromSettings();
// Hydrate per-photo edits so the canvas applies them on first render.
void loadPhotoEdits();
// Wire File > Save/Load Library … menu items to native dialogs +
// backend commands.
registerLibraryFileMenuHandlers();

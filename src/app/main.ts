import "@ui/index";
import "./app-shell";
import { configureFullImageCacheFromSettings } from "./full-image-cache";
import { configureHdImageCacheFromSettings } from "./hd-image-cache";
import { loadPhotoEdits } from "@services/edits/edits-store";
import { loadPhotoEffects } from "@services/effects/effects-store";
import { loadPostProcessPresets } from "@services/post-process/post-process-presets-store";
import { registerLibraryFileMenuHandlers } from "./library-file-menu";
import { configureCacheSettings } from "./cache-settings";

// Sync the in-memory ImageBitmap cache size with the persisted Tauri
// setting (and react to runtime changes from the macOS Cache menu).
void configureCacheSettings().then(() => Promise.all([
  configureFullImageCacheFromSettings(),
  configureHdImageCacheFromSettings(),
]));
// Hydrate per-photo edits so the canvas applies them on first render.
void loadPhotoEdits();
void loadPhotoEffects();
void loadPostProcessPresets();
// Wire File > Save/Load Library … menu items to native dialogs +
// backend commands.
registerLibraryFileMenuHandlers();

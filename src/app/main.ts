import "@ui/index";
import "./app-shell";
import { configureFullImageCacheFromSettings } from "./full-image-cache";

// Sync the in-memory ImageBitmap cache size with the persisted Tauri
// setting (and react to runtime changes from the macOS Cache menu).
void configureFullImageCacheFromSettings();

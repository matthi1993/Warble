import type { Platform } from "./platform";
import { TauriAppWindow, TauriDialogs, TauriTextFiles } from "./tauri-desktop";
import { TauriEditRepository } from "./tauri-edit-repository";
import { TauriImageBackend } from "./tauri-image-backend";
import { TauriLibraryBackend } from "./tauri-library-backend";
import { TauriSettingsBackend } from "./tauri-settings-backend";

export class TauriPlatform implements Platform {
  readonly dialogs = new TauriDialogs();
  readonly textFiles = new TauriTextFiles();
  readonly window = new TauriAppWindow();
  readonly settings = new TauriSettingsBackend();
  readonly images = new TauriImageBackend();
  readonly library = new TauriLibraryBackend();
  readonly edits = new TauriEditRepository();
  readonly storage = localStorage;
}

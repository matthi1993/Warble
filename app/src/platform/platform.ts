import type { EditRepository, KeyValueStorage } from "@warble/editing";
import type { LibraryBackend } from "@warble/library";
import type { ImageBackend } from "@warble/media";
import type { AppWindow, Dialogs, TextFiles } from "./desktop";
import type { SettingsBackend } from "./settings-backend";

/** Everything the app needs from its host environment. Swap this to run outside Tauri. */
export interface Platform {
  readonly dialogs: Dialogs;
  readonly textFiles: TextFiles;
  readonly window: AppWindow;
  readonly settings: SettingsBackend;
  readonly images: ImageBackend;
  readonly library: LibraryBackend;
  readonly edits: EditRepository;
  readonly storage: KeyValueStorage;
}

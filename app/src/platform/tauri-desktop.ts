import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, confirm, message, open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { AppWindow, DialogOptions, Dialogs, FileFilter, TextFiles } from "./desktop";

export class TauriDialogs implements Dialogs {
  confirm(text: string, options: DialogOptions): Promise<boolean> {
    return confirm(text, options);
  }

  ask(text: string, options: DialogOptions): Promise<boolean> {
    return ask(text, options);
  }

  async message(text: string, options: DialogOptions): Promise<void> {
    await message(text, options);
  }

  async pickFile(filters: FileFilter[]): Promise<string | null> {
    const selected = await open({ multiple: false, directory: false, filters });
    return (Array.isArray(selected) ? selected[0] : selected) ?? null;
  }

  pickSaveLocation(defaultPath: string, filters: FileFilter[]): Promise<string | null> {
    return save({ defaultPath, filters });
  }
}

export class TauriTextFiles implements TextFiles {
  read(path: string): Promise<string> {
    return readTextFile(path);
  }

  write(path: string, contents: string): Promise<void> {
    return writeTextFile(path, contents);
  }
}

export class TauriAppWindow implements AppWindow {
  setFullscreen(enabled: boolean): Promise<void> {
    return getCurrentWindow().setFullscreen(enabled);
  }

  focus(): Promise<void> {
    return getCurrentWindow().setFocus();
  }
}

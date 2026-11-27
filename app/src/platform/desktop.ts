export interface DialogOptions {
  title: string;
  kind?: "info" | "warning" | "error";
  okLabel?: string;
  cancelLabel?: string;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface Dialogs {
  confirm(text: string, options: DialogOptions): Promise<boolean>;
  ask(text: string, options: DialogOptions): Promise<boolean>;
  message(text: string, options: DialogOptions): Promise<void>;
  pickFile(filters: FileFilter[]): Promise<string | null>;
  pickSaveLocation(defaultPath: string, filters: FileFilter[]): Promise<string | null>;
}

export interface TextFiles {
  read(path: string): Promise<string>;
  write(path: string, contents: string): Promise<void>;
}

export interface AppWindow {
  setFullscreen(enabled: boolean): Promise<void>;
  focus(): Promise<void>;
}

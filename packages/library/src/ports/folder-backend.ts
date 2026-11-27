import type { Unsubscribe } from "@warble/core";
import type { Folder } from "../folder/folder";
import type {
  FolderImageUpdate,
  FolderScanProgress,
  FolderSelection,
  FolderUpdate,
} from "./library-events";

export interface FolderImportResult {
  folders: Folder[];
  imported: Folder[];
}

export interface FolderBackend {
  importFolders(selections: readonly FolderSelection[]): Promise<FolderImportResult>;
  listImportedFolders(): Promise<Folder[]>;
  refreshImportedFolders(): Promise<Folder[]>;
  refreshFolder(folderPath: string): Promise<Folder[]>;
  indexFolderImages(folderPath: string, recursive: boolean): Promise<void>;
  removeImportedFolder(rootId: string): Promise<Folder[]>;
  selectFoldersDialog(): Promise<FolderSelection[]>;
  bindMediaRoot(rootId: string, path: string, bookmark: string | null): Promise<Folder[]>;
  getFolderPhotoCounts(): Promise<Record<string, number>>;
  onFoldersRehydrated(listener: () => void): Promise<Unsubscribe>;
  onFolderScanProgress(listener: (progress: FolderScanProgress) => void): Promise<Unsubscribe>;
  onFoldersUpdated(listener: (update: FolderUpdate) => void): Promise<Unsubscribe>;
  onFolderImagesUpdated(listener: (update: FolderImageUpdate) => void): Promise<Unsubscribe>;
}

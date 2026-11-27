import type { Folder } from "../folder/folder";

export interface FolderSelection {
  path: string;
  bookmark: string | null;
}

export interface FolderScanProgress {
  phase: "queued" | "scanning" | "indexing" | "done" | "cancelled" | "error";
  kind: "folderTree" | "folderImages" | "folderCheck";
  rootId: string;
  folderKey: string;
  jobId: number;
  message?: string;
}

export interface FolderUpdate {
  folders: Folder[];
  rootId: string;
  folderKey: string;
  contentChanged: boolean;
}

export interface FolderImageUpdate {
  rootId: string;
  folderKey: string;
}

export interface PhotoIndexUpdate {
  folderKey: string;
  changedImages: string[];
  metadataChanged: boolean;
}

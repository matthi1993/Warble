import type { Unsubscribe } from "@warble/core";
import type { Photo } from "../photo/photo";
import type { PhotoIndexUpdate } from "./library-events";

export interface PhotoBackend {
  getPhotosInFolder(folderPath: string, recursive: boolean): Promise<Photo[]>;
  getAllPhotos(): Promise<Photo[]>;
  refreshPhotoParent(photoPath: string): Promise<void>;
  revealInFileManager(path: string): Promise<void>;
  openPhotoInApp(path: string): Promise<void>;
  openRawInDefaultApp(path: string): Promise<void>;
  onPhotoIndexSynced(listener: (update: PhotoIndexUpdate) => void): Promise<Unsubscribe>;
}

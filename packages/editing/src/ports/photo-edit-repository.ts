import type { PhotoEdit } from "../photo/photo-edit";

export interface PersistedPhotoEdit extends PhotoEdit {
  readonly path: string;
}

export interface PhotoEditRepository {
  getPhotoEdits(): Promise<PersistedPhotoEdit[]>;
  setPhotoEdit(edit: PersistedPhotoEdit): Promise<void>;
  clearPhotoEdit(path: string): Promise<void>;
}

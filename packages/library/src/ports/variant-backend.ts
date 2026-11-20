import type { PhotoFormat } from "../photo/variants";

export interface PersistedVariantPref {
  path: string;
  format: string;
  variant: string;
}

export interface PhotoVariantSave {
  photoPath: string;
  variant: string;
  overwrite: boolean;
  jpegBytes: Uint8Array;
}

export interface VariantBackend {
  getPhotoVariants(): Promise<PersistedVariantPref[]>;
  setPhotoVariant(path: string, format: PhotoFormat, variant: string): Promise<void>;
  photoVariantExists(photoPath: string, variant: string): Promise<boolean>;
  savePhotoVariant(save: PhotoVariantSave): Promise<void>;
  trashPhotoVariant(photoPath: string): Promise<void>;
  /** Resolves with the number of files moved to the bin. */
  trashPhotoGroup(photoPath: string): Promise<number>;
}

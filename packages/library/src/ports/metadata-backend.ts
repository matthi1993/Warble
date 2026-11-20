import type { ExifMetadata } from "../exif/exif-metadata";
import type { PhotoFilterMetadata } from "../photo/photo";

export type EditableMetadataField =
  | "dateTaken"
  | "artist"
  | "copyright"
  | "cameraMake"
  | "cameraModel"
  | "lensModel";

export type PhotoMetadataChanges = Partial<Record<EditableMetadataField, string>>;

export interface MetadataBackend {
  getPhotoFilterMetadata(
    photoPaths: readonly string[],
    requestId: number,
  ): Promise<PhotoFilterMetadata[]>;
  getCachedPhotoFilterMetadata(photoPaths: readonly string[]): Promise<PhotoFilterMetadata[]>;
  getExifMetadata(photoPath: string, requestId?: number): Promise<ExifMetadata | null>;
  setPhotoMetadata(photoPaths: readonly string[], changes: PhotoMetadataChanges): Promise<void>;
}

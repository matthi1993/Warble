export type { Photo, PhotoFile, PhotoFilterInfo, PhotoFilterMetadata } from "./photo/photo";
export type { PhotoFormat, VariantOption } from "./photo/variants";
export {
  availableFormats,
  availableVariants,
  classifyFormat,
  fileForSelection,
  primarySelection,
  RAW_EXTS,
} from "./photo/variants";
export type { MediaType } from "./photo/media-type";
export { photoMediaTypes, variantCount, VIDEO_EXTENSIONS } from "./photo/media-type";
export { sortPhotosOldestFirst } from "./photo/photo-sort";
export { VariantStore, type VariantPref } from "./photo/variant-store";

export type { Folder } from "./folder/folder";
export { buildFolderForest, findFolderByPath } from "./folder/folder-tree";

export type { Album } from "./album/album";

export type { ColorLabel, PhotoRating } from "./rating/rating";
export {
  clampRating,
  COLOR_LABELS,
  LABEL_COLORS,
  LABEL_DISPLAY_NAMES,
  sanitizeLabel,
} from "./rating/rating";
export { KEY_TO_LABEL, RATING_LABEL_KEYS } from "./rating/shortcuts";
export { RatingStore } from "./rating/rating-store";

export type { ExifMetadata } from "./exif/exif-metadata";
export type { ExifRow, ExifSection } from "./exif/sections";
export { buildExifSections } from "./exif/sections";
export {
  formatCameraName,
  formatDimensions,
  formatExifDate,
  formatGpsCoords,
  formatLensName,
} from "./exif/formatters";
export { ExifReader } from "./exif/exif-reader";

export { captureDay } from "./dates/capture-day";
export { dateSelectionLabel, matchesDateSelection, UNDATED_KEY } from "./dates/date-selection";
export { DateTreeIndex, type DateTreeNode } from "./dates/date-tree-index";
export { DatePhotoIndex, type PhotoEnricher } from "./dates/date-photo-index";
export { getDayGroups, type PhotoDayGroup } from "./dates/day-groups";

export {
  PhotoFilter,
  type PhotoFilterCriteria,
  type PhotoRatingLookup,
} from "./filter/photo-filter";
export { cameraOptions, lensOptions } from "./filter/filter-options";

export { PhotoProcessingPipeline } from "./processing/photo-processing-pipeline";

export type { AlbumBackend } from "./ports/album-backend";
export type { BackendRequests } from "./ports/backend-requests";
export type { FolderBackend, FolderImportResult } from "./ports/folder-backend";
export type { LibraryBackend } from "./ports/library-backend";
export type {
  FolderImageUpdate,
  FolderScanProgress,
  FolderSelection,
  FolderUpdate,
  PhotoIndexUpdate,
} from "./ports/library-events";
export type {
  EditableMetadataField,
  MetadataBackend,
  PhotoMetadataChanges,
} from "./ports/metadata-backend";
export type { PhotoBackend } from "./ports/photo-backend";
export type { PersistedPhotoRating, RatingBackend } from "./ports/rating-backend";
export type { ThumbnailWarmer } from "./ports/thumbnail-warmer";
export type {
  PersistedVariantPref,
  PhotoVariantSave,
  VariantBackend,
} from "./ports/variant-backend";
export type { WorkspaceBackend } from "./ports/workspace-backend";

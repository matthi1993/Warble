import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Unsubscribe } from "@warble/core";
import type {
  Album,
  ColorLabel,
  ExifMetadata,
  Folder,
  FolderImageUpdate,
  FolderScanProgress,
  FolderSelection,
  FolderUpdate,
  LibraryBackend,
  PersistedPhotoRating,
  PersistedVariantPref,
  Photo,
  PhotoFilterMetadata,
  PhotoFormat,
  PhotoIndexUpdate,
  PhotoMetadataChanges,
  PhotoVariantSave,
} from "@warble/library";
import type { FolderImportResult } from "@warble/library";

export class TauriLibraryBackend implements LibraryBackend {
  getPhotoRatings(): Promise<PersistedPhotoRating[]> {
    return invoke<PersistedPhotoRating[]>("get_photo_ratings");
  }

  setPhotoRating(path: string, rating: number, label: ColorLabel): Promise<number> {
    return invoke<number>("set_photo_rating", { path, rating, label });
  }

  getPhotoVariants(): Promise<PersistedVariantPref[]> {
    return invoke<PersistedVariantPref[]>("get_photo_variants");
  }

  setPhotoVariant(path: string, format: PhotoFormat, variant: string): Promise<void> {
    return invoke("set_photo_variant", { path, format, variant });
  }

  photoVariantExists(photoPath: string, variant: string): Promise<boolean> {
    return invoke<boolean>("photo_variant_exists", { photoPath, variant });
  }

  savePhotoVariant({ photoPath, variant, overwrite, jpegBytes }: PhotoVariantSave): Promise<void> {
    return invoke("save_photo_variant", jpegBytes, {
      headers: {
        "photo-path": encodeURIComponent(photoPath),
        variant: encodeURIComponent(variant),
        overwrite: String(overwrite),
      },
    });
  }

  trashPhotoVariant(photoPath: string): Promise<void> {
    return invoke("trash_photo_variant", { photoPath });
  }

  trashPhotoGroup(photoPath: string): Promise<number> {
    return invoke<number>("trash_photo_group", { photoPath });
  }

  getPhotoFilterMetadata(
    photoPaths: readonly string[],
    requestId: number,
  ): Promise<PhotoFilterMetadata[]> {
    return invoke<PhotoFilterMetadata[]>("get_photo_filter_metadata", { photoPaths, requestId });
  }

  getCachedPhotoFilterMetadata(photoPaths: readonly string[]): Promise<PhotoFilterMetadata[]> {
    return invoke<PhotoFilterMetadata[]>("get_cached_photo_filter_metadata", { photoPaths });
  }

  getExifMetadata(photoPath: string, requestId?: number): Promise<ExifMetadata | null> {
    return invoke<ExifMetadata | null>("get_exif_metadata", { photoPath, requestId });
  }

  setPhotoMetadata(photoPaths: readonly string[], changes: PhotoMetadataChanges): Promise<void> {
    return invoke("set_photo_metadata", { photoPaths, changes });
  }

  getPhotosInFolder(folderPath: string, recursive: boolean): Promise<Photo[]> {
    return invoke<Photo[]>("get_photos_in_folder", { folderPath, recursive });
  }

  getAllPhotos(): Promise<Photo[]> {
    return invoke<Photo[]>("get_all_photos");
  }

  refreshPhotoParent(photoPath: string): Promise<void> {
    return invoke("refresh_photo_parent", { photoPath });
  }

  revealInFileManager(path: string): Promise<void> {
    return invoke("reveal_in_file_manager", { path });
  }

  openPhotoInApp(path: string): Promise<void> {
    return invoke("open_photo_in_app", { path });
  }

  openRawInDefaultApp(path: string): Promise<void> {
    return invoke("open_raw_in_default_app", { path });
  }

  onPhotoIndexSynced(listener: (update: PhotoIndexUpdate) => void): Promise<Unsubscribe> {
    return listen<PhotoIndexUpdate>("photo-index-synced", (event) => listener(event.payload));
  }

  listImportedFolders(): Promise<Folder[]> {
    return invoke<Folder[]>("list_imported_folders");
  }

  refreshImportedFolders(): Promise<Folder[]> {
    return invoke<Folder[]>("refresh_imported_folders");
  }

  refreshFolder(folderPath: string): Promise<Folder[]> {
    return invoke<Folder[]>("refresh_folder", { folderPath });
  }

  indexFolderImages(folderPath: string, recursive: boolean): Promise<void> {
    return invoke("index_folder_images", { folderPath, recursive });
  }

  removeImportedFolder(rootId: string): Promise<Folder[]> {
    return invoke<Folder[]>("remove_imported_folder", { rootId });
  }

  selectFoldersDialog(): Promise<FolderSelection[]> {
    return invoke<FolderSelection[]>("select_folders_dialog");
  }

  importFolders(selections: readonly FolderSelection[]): Promise<FolderImportResult> {
    return invoke<FolderImportResult>("import_folders", { selections });
  }

  bindMediaRoot(rootId: string, path: string, bookmark: string | null): Promise<Folder[]> {
    return invoke<Folder[]>("bind_media_root", { rootId, path, bookmark });
  }

  getFolderPhotoCounts(): Promise<Record<string, number>> {
    return invoke<Record<string, number>>("get_folder_photo_counts");
  }

  onFoldersRehydrated(listener: () => void): Promise<Unsubscribe> {
    return listen("folders-rehydrated", () => listener());
  }

  onFolderScanProgress(listener: (progress: FolderScanProgress) => void): Promise<Unsubscribe> {
    return listen<FolderScanProgress>("folder-scan-progress", (event) => listener(event.payload));
  }

  onFoldersUpdated(listener: (update: FolderUpdate) => void): Promise<Unsubscribe> {
    return listen<FolderUpdate>("folders-updated", (event) => listener(event.payload));
  }

  onFolderImagesUpdated(listener: (update: FolderImageUpdate) => void): Promise<Unsubscribe> {
    return listen<FolderImageUpdate>("folder-images-updated", (event) => listener(event.payload));
  }

  listAlbums(): Promise<Album[]> {
    return invoke<Album[]>("list_albums");
  }

  createAlbum(name: string, description: string): Promise<string> {
    return invoke<string>("create_album", { name, description });
  }

  updateAlbum(id: string, name: string, description: string): Promise<void> {
    return invoke("update_album", { id, name, description });
  }

  deleteAlbum(id: string): Promise<void> {
    return invoke("delete_album", { id });
  }

  getAlbumPhotos(id: string): Promise<Photo[]> {
    return invoke<Photo[]>("get_album_photos", { id });
  }

  addPhotosToAlbum(id: string, photoPaths: readonly string[]): Promise<void> {
    return invoke("add_photos_to_album", { id, photoPaths });
  }

  getLastFolder(): Promise<string | null> {
    return invoke<string | null>("get_last_folder");
  }

  setLastFolder(path: string): Promise<void> {
    return invoke("set_last_folder", { path });
  }

  resetWorkspace(): Promise<void> {
    return invoke("reset_workspace");
  }
}

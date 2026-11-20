import { DisposableBag } from "@warble/core";
import type { Photo, PhotoBackend, PhotoIndexUpdate } from "@warble/library";
import type { FolderCountsController } from "./folder-counts-controller";
import type { FolderSelectionController } from "./folder-selection-controller";
import type { LibraryPhotosController } from "./library-photos-controller";
import type { PhotoDataSync } from "./photo-data-sync";
import type { DateIndex, PhotoPipeline } from "./photo-list-controller";
import type { ShellState } from "./shell-state";
import type { ShellViews } from "./shell-views";

interface PathCache {
  invalidate(paths: readonly string[]): void;
}

export interface ImageCaches {
  readonly thumbnails: PathCache;
  readonly hdImages: PathCache;
  readonly fullImages: PathCache;
}

export class PhotoIndexController {
  private readonly subscriptions = new DisposableBag();

  constructor(
    private readonly state: ShellState,
    private readonly backend: Pick<PhotoBackend, "onPhotoIndexSynced">,
    private readonly caches: ImageCaches,
    private readonly pipeline: PhotoPipeline,
    private readonly dates: DateIndex,
    private readonly views: Pick<ShellViews, "fullView" | "reloadThumbnails">,
    private readonly photoData: Pick<PhotoDataSync, "flushPendingWrites" | "reloadEditsAndRatings">,
    private readonly counts: Pick<FolderCountsController, "refresh">,
    private readonly libraryPhotos: Pick<LibraryPhotosController, "refresh">,
    private readonly folderSelection: Pick<FolderSelectionController, "refreshFromIndex">,
  ) {}

  async subscribe(): Promise<void> {
    this.subscriptions.add(await this.backend.onPhotoIndexSynced((update) => void this.synced(update)));
  }

  dispose(): void {
    this.subscriptions.dispose();
  }

  async synced(update: PhotoIndexUpdate): Promise<void> {
    void this.counts.refresh();
    if (update.metadataChanged) this.forgetFolderMetadata(update.folderKey);
    if (update.changedImages.length > 0) this.forgetImages(update.changedImages);
    if (update.metadataChanged) {
      try {
        await this.photoData.flushPendingWrites();
      } catch (error) {
        console.error("Could not reconcile photo metadata with pending local writes", error);
        return;
      }
      await this.photoData.reloadEditsAndRatings();
    }
    if (update.changedImages.length > 0 || update.metadataChanged) void this.libraryPhotos.refresh();
    if (this.selectionTouches(update.folderKey)) await this.folderSelection.refreshFromIndex();
  }

  private forgetFolderMetadata(folderKey: string): void {
    const state = this.state;
    const inFolder = (photo: Photo): boolean => photo.path.startsWith(`${folderKey}/`);
    this.pipeline.invalidate(state.libraryPhotos.filter(inFolder).map((photo) => photo.path));
    state.change({ photos: state.photos.map((photo) => (inFolder(photo) ? this.withoutMetadata(photo) : photo)) });
    this.dates.invalidatePhotos();
  }

  private forgetImages(paths: string[]): void {
    const state = this.state;
    const changed = new Set(paths);
    this.pipeline.invalidate(paths);
    state.change({
      photos: state.photos.map((photo) => (changed.has(photo.path) ? this.withoutMetadata(photo) : photo)),
    });
    const selectedChanged = state.selectedPhoto !== null && changed.has(state.selectedPhoto.path);
    if (state.selectedPhoto && selectedChanged) {
      state.change({ selectedPhoto: this.withoutMetadata(state.selectedPhoto) });
    }
    this.caches.thumbnails.invalidate(paths);
    this.caches.hdImages.invalidate(paths);
    this.caches.fullImages.invalidate(paths);
    if (state.selectedPhoto && selectedChanged) this.views.fullView()?.refreshPhotoSource(state.selectedPhoto.path);
    this.views.reloadThumbnails(changed);
  }

  private withoutMetadata(photo: Photo): Photo {
    return { ...photo, filterInfo: undefined };
  }

  private selectionTouches(folderKey: string): boolean {
    const selected = this.state.selectedFolderId;
    if (!selected) return false;
    return (
      selected === folderKey ||
      selected.startsWith(`${folderKey}/`) ||
      (this.state.includeSubfolders && folderKey.startsWith(`${selected}/`))
    );
  }
}

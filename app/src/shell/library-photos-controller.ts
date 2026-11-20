import type { MetadataBackend, PhotoBackend } from "@warble/library";
import type { AlbumsController } from "./albums-controller";
import type { DateIndex, PhotoListController, PhotoPipeline } from "./photo-list-controller";
import type { ShellState } from "./shell-state";

const CACHED_METADATA_BATCH_SIZE = 256;

export type LibraryPhotosBackend = Pick<PhotoBackend, "getAllPhotos"> &
  Pick<MetadataBackend, "getCachedPhotoFilterMetadata">;

export class LibraryPhotosController {
  private request = 0;

  constructor(
    private readonly state: ShellState,
    private readonly backend: LibraryPhotosBackend,
    private readonly pipeline: PhotoPipeline,
    private readonly dates: DateIndex,
    private readonly photoList: PhotoListController,
    private readonly albums: Pick<AlbumsController, "load" | "refreshPhotos">,
  ) {}

  async refresh(): Promise<void> {
    const state = this.state;
    const request = ++this.request;
    try {
      const photos = await this.backend.getAllPhotos();
      if (request !== this.request) return;
      void this.albums.load();
      state.change({ restoringCachedDates: true, filterMetadataLoading: true, libraryPhotos: photos });
      this.photoList.showLibraryPhotos(false);
      if (state.mode === "albums") void this.albums.refreshPhotos();
      if (!(await this.restoreCachedMetadata(request))) return;
      state.change({ restoringCachedDates: false, filterMetadataLoading: false });
      this.dates.invalidatePhotos();
      if (state.mode === "days") this.photoList.applyDateMetadata();
      else if (state.selectedFolderId) this.photoList.applyPhotoMetadata();
      else this.photoList.showLibraryPhotos(false);
      this.photoList.startBackgroundWork();
    } catch (error) {
      if (request === this.request) state.change({ restoringCachedDates: false, filterMetadataLoading: false });
      console.error("Failed to load all photos", error);
    }
  }

  /** Resolves false when a newer refresh replaced this one. */
  private async restoreCachedMetadata(request: number): Promise<boolean> {
    const state = this.state;
    try {
      const paths = this.pipeline.missingMetadataPaths(state.libraryPhotos);
      for (let start = 0; start < paths.length; start += CACHED_METADATA_BATCH_SIZE) {
        const cached = await this.backend.getCachedPhotoFilterMetadata(
          paths.slice(start, start + CACHED_METADATA_BATCH_SIZE),
        );
        if (request !== this.request) return false;
        this.pipeline.seed(cached);
        this.dates.invalidatePhotos();
        this.dates.updateMetadata(state.libraryPhotos, cached);
        state.refresh();
      }
    } catch (error) {
      console.warn("Failed to restore cached photo dates", error);
      if (request === this.request) this.photoList.showLibraryPhotos(false);
    }
    return request === this.request;
  }
}

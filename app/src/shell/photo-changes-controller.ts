import { sortPhotosOldestFirst, type Photo, type PhotoBackend } from "@warble/library";
import type { AlbumsController } from "./albums-controller";
import type { FolderCountsController } from "./folder-counts-controller";
import type { LibraryPhotosController } from "./library-photos-controller";
import type { PhotoListController, PhotoPipeline } from "./photo-list-controller";
import type { ShellState } from "./shell-state";
import type { ShellViews } from "./shell-views";

export interface PhotoCatalogChange {
  kind: "save" | "variant-delete" | "photo-delete";
  photoPath: string;
  memberPaths: string[];
  previousIndex: number;
}

export interface SavedMetadata {
  paths: string[];
  dateTaken?: string | null;
}

export class PhotoChangesController {
  constructor(
    private readonly state: ShellState,
    private readonly backend: Pick<PhotoBackend, "refreshPhotoParent" | "getPhotosInFolder">,
    private readonly pipeline: Pick<PhotoPipeline, "invalidate">,
    private readonly photoList: Pick<PhotoListController, "setPhotos" | "showLibraryPhotos">,
    private readonly counts: Pick<FolderCountsController, "refresh">,
    private readonly albums: Pick<AlbumsController, "refreshPhotos">,
    private readonly libraryPhotos: Pick<LibraryPhotosController, "refresh">,
    private readonly views: Pick<ShellViews, "detailPanel">,
  ) {}

  async catalogChanged(change: PhotoCatalogChange): Promise<void> {
    const state = this.state;
    if (!state.selectedFolderId && state.mode === "folders") return;
    try {
      await this.backend.refreshPhotoParent(change.photoPath);
      void this.counts.refresh();
      await this.reloadCurrentList();
      if (change.kind === "photo-delete") this.selectNeighbour(change.previousIndex);
      else this.reselect(change);
    } catch (error) {
      console.error("Failed to refresh after changing photo files", error);
    }
  }

  metadataSaved({ paths, dateTaken }: SavedMetadata): void {
    const state = this.state;
    if (state.selectedPhoto && paths.includes(state.selectedPhoto.path)) {
      this.views.detailPanel()?.refreshMetadata();
    }
    if (dateTaken === undefined) return;
    const changed = new Set(paths);
    const day = dateTaken?.slice(0, 10) ?? null;
    const captureTime = dateTaken && dateTaken.length > 10 ? dateTaken.replace("T", " ").slice(0, 19) : null;
    const withDate = (photo: Photo): Photo =>
      changed.has(photo.path)
        ? { ...photo, filterInfo: { ...photo.filterInfo, dateTaken: day, captureTime } }
        : photo;
    this.pipeline.invalidate(paths);
    state.change({
      photos: sortPhotosOldestFirst(state.photos.map(withDate)),
      libraryPhotos: sortPhotosOldestFirst(state.libraryPhotos.map(withDate)),
    });
    if (state.selectedPhoto && changed.has(state.selectedPhoto.path)) {
      state.change({ selectedPhoto: withDate(state.selectedPhoto) });
    }
    if (state.mode === "days") this.photoList.showLibraryPhotos(false);
  }

  private async reloadCurrentList(): Promise<void> {
    const state = this.state;
    if (state.mode === "albums") {
      await this.albums.refreshPhotos();
      void this.libraryPhotos.refresh();
    } else if (state.showsLibraryPhotos) {
      await this.libraryPhotos.refresh();
    } else {
      if (state.selectedFolderId === null) throw new Error("No folder is selected");
      this.photoList.setPhotos(
        await this.backend.getPhotosInFolder(state.selectedFolderId, state.includeSubfolders),
      );
      void this.libraryPhotos.refresh();
    }
  }

  private selectNeighbour(previousIndex: number): void {
    const state = this.state;
    if (state.photos.length === 0) {
      state.change({ selectedPhoto: null, fullViewIndex: null });
      return;
    }
    const index = Math.min(previousIndex, state.photos.length - 1);
    state.change({ selectedPhoto: state.photos[index] });
    if (state.fullViewIndex !== null) state.change({ fullViewIndex: index });
  }

  private reselect({ photoPath, memberPaths }: PhotoCatalogChange): void {
    const state = this.state;
    const oldMembers = new Set(memberPaths);
    const index = state.photos.findIndex(
      (photo) => photo.path === photoPath || photo.files?.some((file) => oldMembers.has(file.path)),
    );
    if (index < 0) return;
    state.change({ selectedPhoto: state.photos[index] });
    if (state.fullViewIndex !== null) state.change({ fullViewIndex: index });
  }
}

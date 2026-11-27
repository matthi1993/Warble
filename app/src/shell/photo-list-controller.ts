import {
  sortPhotosOldestFirst,
  type DatePhotoIndex,
  type Photo,
  type PhotoProcessingPipeline,
  type PhotoRatingLookup,
} from "@warble/library";
import type { ShellState } from "./shell-state";

export type PhotoPipeline = Pick<
  PhotoProcessingPipeline,
  "enrich" | "start" | "stop" | "seed" | "invalidate" | "missingMetadataPaths"
>;
export type DateIndex = Pick<DatePhotoIndex, "photosFor" | "invalidatePhotos" | "syncTree" | "updateMetadata" | "nodes">;

export class PhotoListController {
  constructor(
    private readonly state: ShellState,
    private readonly pipeline: PhotoPipeline,
    private readonly dates: DateIndex,
    private readonly ratings: PhotoRatingLookup,
  ) {}

  setPhotos(photos: Photo[], restartMetadata = true): void {
    this.state.change({ photos: sortPhotosOldestFirst(this.pipeline.enrich(photos)) });
    if (restartMetadata) this.startBackgroundWork();
  }

  startBackgroundWork(): void {
    const state = this.state;
    this.pipeline.start(
      [...state.photos, ...state.libraryPhotos],
      (results) => {
        this.dates.updateMetadata(state.libraryPhotos, results);
        this.dates.invalidatePhotos();
        state.refresh();
      },
      () => state.photos.map((photo) => photo.path),
      (loading) => {
        state.change({ filterMetadataLoading: loading });
        this.dates.syncTree(state.libraryPhotos);
        if (loading) return;
        if (state.mode === "days") this.applyDateMetadata();
        else this.applyPhotoMetadata();
      },
    );
  }

  stopBackgroundWork(): void {
    this.pipeline.stop();
  }

  applyPhotoMetadata(): void {
    const state = this.state;
    const photos = this.pipeline.enrich(state.photos);
    if (photos.every((photo, index) => photo === state.photos[index])) return;
    const enriched = sortPhotosOldestFirst(photos);
    state.change({ photos: enriched });
    const selectedPath = state.selectedPhoto?.path;
    if (!selectedPath) return;
    state.change({ selectedPhoto: enriched.find((photo) => photo.path === selectedPath) ?? state.selectedPhoto });
    if (state.fullViewIndex === null) return;
    const sortedIndex = enriched.findIndex((photo) => photo.path === selectedPath);
    if (sortedIndex >= 0) state.change({ fullViewIndex: sortedIndex });
  }

  applyDateMetadata(): void {
    this.showLibraryPhotos(false);
  }

  showLibraryPhotos(restartMetadata = true): void {
    const state = this.state;
    if (!state.showsLibraryPhotos) return;
    const selectedPath = state.selectedPhoto?.path;
    const previousIndex = state.fullViewIndex;
    if (state.mode === "days") {
      state.change({ photos: this.dates.photosFor(state.libraryPhotos, state.selectedDateKey) });
    } else {
      this.setPhotos(state.mode === "favorites" ? this.favorites() : state.libraryPhotos, restartMetadata);
    }
    if (!selectedPath) return;
    const selectedIndex = state.photos.findIndex((photo) => photo.path === selectedPath);
    if (selectedIndex >= 0) {
      state.change({ selectedPhoto: state.photos[selectedIndex] });
      if (previousIndex !== null) state.change({ fullViewIndex: selectedIndex });
    } else if (previousIndex !== null && state.photos.length > 0) {
      const index = Math.min(previousIndex, state.photos.length - 1);
      state.change({ selectedPhoto: state.photos[index], fullViewIndex: index });
    } else {
      state.change({ selectedPhoto: null, fullViewIndex: null });
    }
  }

  ratingChanged(path: string): void {
    const state = this.state;
    state.refresh();
    if (state.mode !== "favorites") return;
    const membershipChanged = () =>
      state.libraryPhotos.some((photo) => photo.path === path) &&
      state.photos.some((photo) => photo.path === path) !== this.isFavorite(path);
    if (path === "" || membershipChanged()) this.showLibraryPhotos();
  }

  private favorites(): Photo[] {
    return this.state.libraryPhotos.filter((photo) => this.isFavorite(photo.path));
  }

  private isFavorite(path: string): boolean {
    return this.ratings.get(path).rating >= 1;
  }
}

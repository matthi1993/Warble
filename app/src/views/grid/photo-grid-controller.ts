import type { Photo } from "@warble/library";
import { GridColumnsController, type ColumnStorage } from "./grid-columns-controller";
import { GridDaysController } from "./grid-days-controller";
import { GridFilterController, type FilterRatings } from "./grid-filter-controller";
import { GridSelectionController, type SelectionLayout } from "./grid-selection-controller";

export interface PhotoGridHost {
  readonly photos: Photo[];
  readonly selectedPath: string | null;
  readonly filterMetadataLoading: boolean;
  requestUpdate(): void;
  dispatchEvent(event: Event): boolean;
}

export interface PhotoGridDependencies {
  readonly ratings: FilterRatings;
  readonly storage: ColumnStorage;
  readonly layout: SelectionLayout;
}

export interface PhotoGridChanges {
  photos: boolean;
  selectedPath: boolean;
  fullViewClosed: boolean;
}

/** The photo grid without its UI framework: everything behind the `pf-photo-grid` element. */
export class PhotoGridController {
  readonly columns: GridColumnsController;
  readonly filters: GridFilterController;
  readonly days: GridDaysController;
  readonly selection: GridSelectionController;
  private renderedPaths = new Set<string>();

  constructor(
    private readonly host: PhotoGridHost,
    private readonly dependencies: PhotoGridDependencies,
  ) {
    this.columns = new GridColumnsController(host, dependencies.storage);
    this.filters = new GridFilterController(host, dependencies.ratings, () =>
      this.days.resetVisiblePhotoPages(),
    );
    this.days = new GridDaysController(host, () => this.filteredPhotos);
    this.selection = new GridSelectionController(host, this.days, dependencies.layout);
  }

  get filteredPhotos(): Photo[] {
    return this.filters.filterPhotos(this.host.photos, this.host.filterMetadataLoading);
  }

  connect(): void {
    this.filters.connect();
  }

  disconnect(): void {
    this.filters.disconnect();
  }

  firstRendered(): void {
    if (this.host.selectedPath) this.revealSelection();
  }

  hostUpdated(changes: PhotoGridChanges): void {
    if (changes.photos && this.photoSetChanged()) {
      this.days.reset();
      this.selection.resetToPrimary();
    }
    if (changes.selectedPath) this.selection.followPrimary();
    if (changes.fullViewClosed) {
      this.revealSelection();
    } else if (changes.selectedPath && this.host.selectedPath) {
      this.selection.revealPrimaryUnlessClicked();
    }
  }

  private revealSelection(): void {
    this.dependencies.layout.scrollToPhotoSoon(() => this.host.selectedPath);
  }

  /** A reordered or re-enriched list of the same photos keeps the paging and the selection. */
  private photoSetChanged(): boolean {
    const paths = new Set(this.host.photos.map((photo) => photo.path));
    const same =
      paths.size === this.renderedPaths.size && [...paths].every((path) => this.renderedPaths.has(path));
    if (!same) this.renderedPaths = paths;
    return !same;
  }
}

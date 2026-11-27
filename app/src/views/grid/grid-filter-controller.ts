import type { Unsubscribe } from "@warble/core";
import {
  PhotoFilter,
  type ColorLabel,
  type MediaType,
  type Photo,
  type PhotoFilterCriteria,
  type PhotoRatingLookup,
} from "@warble/library";

export interface GridFilterHost {
  requestUpdate(): void;
}

export interface FilterRatings extends PhotoRatingLookup {
  subscribe(listener: (path: string) => void): Unsubscribe;
}

/** The grid's filter settings and the photos that pass them. */
export class GridFilterController {
  criteria: PhotoFilterCriteria = PhotoFilter.emptyCriteria();
  expanded = false;
  private filter: PhotoFilter;
  private ratingsRevision = 0;
  private appliedInputs: readonly unknown[] = [];
  private appliedPhotos: Photo[] = [];
  private unsubscribeRatings: Unsubscribe | null = null;

  constructor(
    private readonly host: GridFilterHost,
    private readonly ratings: FilterRatings,
    private readonly onCriteriaChange: () => void,
  ) {
    this.filter = new PhotoFilter(this.criteria, ratings);
  }

  connect(): void {
    this.unsubscribeRatings = this.ratings.subscribe(() => {
      this.ratingsRevision += 1;
      this.host.requestUpdate();
    });
  }

  disconnect(): void {
    this.unsubscribeRatings?.();
    this.unsubscribeRatings = null;
  }

  get filtersActive(): boolean {
    return this.filter.active;
  }

  /** Returns the same array until the photos, the ratings or the criteria change. */
  filterPhotos(photos: Photo[], metadataLoading: boolean): Photo[] {
    const inputs = [photos, this.ratingsRevision, this.criteria, metadataLoading];
    if (inputs.some((input, index) => input !== this.appliedInputs[index])) {
      this.appliedInputs = inputs;
      this.appliedPhotos = this.filter.apply(photos, metadataLoading);
    }
    return this.appliedPhotos;
  }

  toggleExpanded(): void {
    this.expanded = !this.expanded;
    this.host.requestUpdate();
  }

  setMinStars(stars: number): void {
    this.change({ minStars: this.criteria.minStars === stars ? 0 : stars });
  }

  toggleLabelFilter(label: Exclude<ColorLabel, "">): void {
    this.change({ labels: this.toggled(this.criteria.labels, label) });
  }

  toggleType(type: MediaType): void {
    this.change({ types: this.toggled(this.criteria.types, type) });
  }

  setCamera(camera: string): void {
    this.change({ camera });
  }

  setLens(lens: string): void {
    this.change({ lens });
  }

  setStartDate(startDate: string): void {
    this.change({ startDate });
  }

  setEndDate(endDate: string): void {
    this.change({ endDate });
  }

  clearFilters(): void {
    this.change(PhotoFilter.emptyCriteria());
  }

  private toggled<T>(values: ReadonlySet<T>, value: T): Set<T> {
    const next = new Set(values);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  private change(changes: Partial<PhotoFilterCriteria>): void {
    this.criteria = { ...this.criteria, ...changes };
    this.filter = new PhotoFilter(this.criteria, this.ratings);
    this.onCriteriaChange();
    this.host.requestUpdate();
  }
}

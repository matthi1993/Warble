import type { Unsubscribe } from "@warble/core";
import type { ColorLabel, Photo, PhotoRating } from "@warble/library";

export interface SelectionRatingHost {
  readonly photo: Photo | null;
  readonly selectionPaths: readonly string[];
  readonly fullViewOpen: boolean;
  requestUpdate(): void;
}

export interface SelectionRatings {
  get(path: string): PhotoRating;
  setStars(paths: readonly string[], rating: number): void;
  setLabel(paths: readonly string[], label: ColorLabel): void;
  subscribe(listener: (path: string) => void): Unsubscribe;
}

/**
 * Rates the shown photo, or the whole grid selection when the photo is part of
 * it. In the full view only the shown photo is rated.
 */
export class SelectionRatingController {
  private unsubscribe: Unsubscribe | null = null;

  constructor(
    private readonly host: SelectionRatingHost,
    private readonly ratings: SelectionRatings,
  ) {}

  connect(): void {
    this.unsubscribe = this.ratings.subscribe(() => this.host.requestUpdate());
  }

  disconnect(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  get targets(): readonly string[] {
    const { photo, selectionPaths, fullViewOpen } = this.host;
    if (!photo) return [];
    return !fullViewOpen && selectionPaths.includes(photo.path) ? selectionPaths : [photo.path];
  }

  /** The stars every target has, or `null` when they differ. */
  get commonRating(): number | null {
    return this.common((rating) => rating.rating);
  }

  get commonLabel(): ColorLabel | null {
    return this.common((rating) => rating.label);
  }

  toggleStars(stars: number): void {
    this.ratings.setStars(this.targets, this.commonRating === stars ? 0 : stars);
  }

  toggleLabel(label: ColorLabel): void {
    this.ratings.setLabel(this.targets, this.commonLabel === label ? "" : label);
  }

  private common<T>(value: (rating: PhotoRating) => T): T | null {
    const values = this.targets.map((path) => value(this.ratings.get(path)));
    return values.length > 0 && values.every((item) => item === values[0]) ? values[0] : null;
  }
}

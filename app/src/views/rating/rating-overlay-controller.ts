import type { Unsubscribe } from "@warble/core";
import type { PhotoRating } from "@warble/library";

const FLASH_MS = 2000;

export interface RatingOverlayHost {
  readonly path: string;
  requestUpdate(): void;
  toggleAttribute(name: string, force?: boolean): boolean;
}

export interface OverlayRatings {
  get(path: string): PhotoRating;
  setStars(paths: readonly string[], rating: number): void;
  subscribe(listener: (path: string) => void): Unsubscribe;
}

/** Follows the rating of the host's photo and flashes the badges when it changes. */
export class RatingOverlayController {
  value: PhotoRating = { rating: 0, label: "", ratedAt: 0 };
  private unsubscribe: Unsubscribe | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly host: RatingOverlayHost,
    private readonly ratings: OverlayRatings,
  ) {}

  connect(): void {
    this.value = this.ratings.get(this.host.path);
    this.host.requestUpdate();
    this.unsubscribe = this.ratings.subscribe((path) => {
      if (path === this.host.path || path === "") this.refresh();
    });
  }

  disconnect(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.flashTimer !== null) clearTimeout(this.flashTimer);
    this.flashTimer = null;
  }

  pathChanged(): void {
    this.value = this.ratings.get(this.host.path);
  }

  rate(star: number): void {
    if (!this.host.path) return;
    const clearsRating = this.value.rating === star && star === 1;
    this.ratings.setStars([this.host.path], clearsRating ? 0 : star);
  }

  private refresh(): void {
    const next = this.ratings.get(this.host.path);
    const changed = next.rating !== this.value.rating || next.label !== this.value.label;
    this.value = next;
    this.host.requestUpdate();
    if (changed) this.startFlash();
  }

  private startFlash(): void {
    this.host.toggleAttribute("flashing", true);
    if (this.flashTimer !== null) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      this.host.toggleAttribute("flashing", false);
      this.flashTimer = null;
    }, FLASH_MS);
  }
}

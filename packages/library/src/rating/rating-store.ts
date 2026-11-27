import { Emitter, type Unsubscribe } from "@warble/core";
import type { RatingBackend } from "../ports/rating-backend";
import { type ColorLabel, type PhotoRating, clampRating, sanitizeLabel } from "./rating";
import { KEY_TO_LABEL } from "./shortcuts";

type RatingChange = Partial<Pick<PhotoRating, "rating" | "label">>;

export class RatingStore {
  private readonly ratings = new Map<string, PhotoRating>();
  private readonly pendingWrites = new Map<string, Promise<void>>();
  private readonly failedWrites = new Map<string, unknown>();
  private readonly changes = new Emitter<string>();
  private loaded = false;
  private loadPromise: Promise<void> | null = null;

  constructor(private readonly backend: RatingBackend) {}

  load(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.backend
      .getPhotoRatings()
      .then((rows) => {
        for (const row of rows) {
          const rating = clampRating(row.rating);
          const label = sanitizeLabel(row.label);
          if (rating === 0 && label === "") continue;
          const ratedAt = typeof row.ratedAt === "number" ? row.ratedAt : 0;
          this.ratings.set(row.path, { rating, label, ratedAt });
        }
        this.loaded = true;
        this.changes.emit("");
      })
      .catch((error) => {
        console.error("Failed to load photo ratings", error);
        this.loaded = true;
      });
    return this.loadPromise;
  }

  reload(): Promise<void> {
    this.ratings.clear();
    this.loaded = false;
    this.loadPromise = null;
    return this.load();
  }

  get(path: string): PhotoRating {
    return this.ratings.get(path) ?? { rating: 0, label: "", ratedAt: 0 };
  }

  setStars(paths: readonly string[], rating: number): void {
    this.change(paths, { rating: clampRating(rating) });
  }

  setLabel(paths: readonly string[], label: ColorLabel): void {
    this.change(paths, { label: sanitizeLabel(label) });
  }

  /** Keys 0–5 set the stars; keys 6–9 toggle a label, clearing it only when every photo has it. */
  applyShortcut(paths: readonly string[], key: string): boolean {
    if (key >= "0" && key <= "5") {
      this.setStars(paths, Number(key));
      return true;
    }
    const label = KEY_TO_LABEL[key];
    if (!label) return false;
    const clear = paths.length > 0 && paths.every((path) => this.get(path).label === label);
    this.setLabel(paths, clear ? "" : label);
    return true;
  }

  async flush(): Promise<void> {
    await Promise.allSettled([...this.pendingWrites.values()]);
    if (this.failedWrites.size > 0) {
      throw new Error(`Could not save ratings for ${this.failedWrites.size} photo(s) to XMP`);
    }
  }

  /** Listeners receive the changed path, or "" when several photos changed at once. */
  subscribe(listener: (path: string) => void): Unsubscribe {
    return this.changes.subscribe(listener);
  }

  private change(paths: readonly string[], change: RatingChange): void {
    const targets = [...new Set(paths)];
    const ratedAt = Math.floor(Date.now() / 1000);
    const values = targets.map((path) => ({ ...this.get(path), ...change, ratedAt }));
    for (const [index, path] of targets.entries()) {
      const next = values[index];
      if (next.rating === 0 && next.label === "") this.ratings.delete(path);
      else this.ratings.set(path, next);
    }
    for (const [index, path] of targets.entries()) this.persist(path, values[index]);
    if (targets.length) this.changes.emit(targets.length === 1 ? targets[0] : "");
  }

  private persist(path: string, value: PhotoRating): void {
    const previous = this.pendingWrites.get(path) ?? Promise.resolve();
    const write = previous
      .catch(() => {})
      .then(() => this.backend.setPhotoRating(path, value.rating, value.label))
      .then((ratedAt) => this.adoptPersistedTimestamp(path, value, ratedAt));
    this.pendingWrites.set(path, write);
    const finished = () => {
      if (this.pendingWrites.get(path) === write) this.pendingWrites.delete(path);
    };
    void write.then(
      () => {
        this.failedWrites.delete(path);
        finished();
      },
      (error) => {
        this.failedWrites.set(path, error);
        console.error("Failed to persist photo rating", error);
        finished();
      },
    );
  }

  private adoptPersistedTimestamp(path: string, written: PhotoRating, ratedAt: number): void {
    const current = this.ratings.get(path);
    if (!current) return;
    if (current.rating !== written.rating || current.label !== written.label) return;
    if (current.ratedAt === ratedAt) return;
    this.ratings.set(path, { ...current, ratedAt });
    this.changes.emit(path);
  }
}

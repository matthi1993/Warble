/**
 * Per-photo star rating (0..=5) and color label store. Persists into
 * the `photo_ratings` SQLite table via Tauri IPC. The original file on
 * disk is never modified.
 */
import { invoke } from "@tauri-apps/api/core";
import {
  type ColorLabel,
  type PhotoRating,
  clampRating,
  sanitizeLabel,
} from "@domain/rating";
import { KEY_TO_LABEL } from "@domain/rating/shortcuts";

interface PersistedRow {
  path: string;
  rating: number;
  label: string;
  ratedAt: number;
}

const ratings = new Map<string, PhotoRating>();
const pendingWrites = new Map<string, Promise<void>>();
const failedWrites = new Map<string, unknown>();
const listeners = new Set<(path: string) => void>();
let loaded = false;
let loadPromise: Promise<void> | null = null;

export function loadPhotoRatings(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadPromise = invoke<PersistedRow[]>("get_photo_ratings")
    .then((rows) => {
      for (const r of rows) {
        const rating = clampRating(r.rating);
        const label = sanitizeLabel(r.label);
        if (rating === 0 && label === "") continue;
        ratings.set(r.path, {
          rating,
          label,
          ratedAt: typeof r.ratedAt === "number" ? r.ratedAt : 0,
        });
      }
      loaded = true;
      notify("");
    })
    .catch((err) => {
      console.error("Failed to load photo ratings", err);
      loaded = true;
    });
  return loadPromise;
}

/** Drop all in-memory ratings and re-fetch after a folder-sidecar rescan. */
export function reloadPhotoRatings(): Promise<void> {
  ratings.clear();
  loaded = false;
  loadPromise = null;
  return loadPhotoRatings();
}

export function getPhotoRating(path: string): PhotoRating {
  return ratings.get(path) ?? { rating: 0, label: "", ratedAt: 0 };
}

function persist(path: string, value: PhotoRating): void {
  const previous = pendingWrites.get(path) ?? Promise.resolve();
  const write = previous.catch(() => {}).then(() => invoke<number>("set_photo_rating", {
    path,
    rating: value.rating,
    label: value.label,
  }))
    .then((ratedAt) => {
      // Backend returns the canonical timestamp it just persisted
      // (or 0 if the row was deleted). Update the in-memory row so
      // subscribers see the same value the DB has.
      const cur = ratings.get(path);
      if (!cur) return;
      if (cur.rating !== value.rating || cur.label !== value.label) return;
      if (cur.ratedAt === ratedAt) return;
      ratings.set(path, { ...cur, ratedAt });
      notify(path);
    });
  pendingWrites.set(path, write);
  const finished = () => {
    if (pendingWrites.get(path) === write) pendingWrites.delete(path);
  };
  void write.then(() => {
    failedWrites.delete(path);
    finished();
  }, (error) => {
    failedWrites.set(path, error);
    console.error("Failed to persist photo rating", error);
    finished();
  });
}

export async function flushPhotoRatings(): Promise<void> {
  await Promise.allSettled([...pendingWrites.values()]);
  if (failedWrites.size > 0) {
    throw new Error(`Could not save ratings for ${failedWrites.size} photo(s) to XMP`);
  }
}

export function setPhotoStars(path: string, rating: number): void {
  const next: PhotoRating = {
    rating: clampRating(rating),
    label: ratings.get(path)?.label ?? "",
    ratedAt: Math.floor(Date.now() / 1000),
  };
  if (next.rating === 0 && next.label === "") {
    ratings.delete(path);
  } else {
    ratings.set(path, next);
  }
  notify(path);
  persist(path, next);
}

export function setPhotoLabel(path: string, label: ColorLabel): void {
  const next: PhotoRating = {
    rating: ratings.get(path)?.rating ?? 0,
    label: sanitizeLabel(label),
    ratedAt: Math.floor(Date.now() / 1000),
  };
  if (next.rating === 0 && next.label === "") {
    ratings.delete(path);
  } else {
    ratings.set(path, next);
  }
  notify(path);
  persist(path, next);
}

export function toggleLabel(path: string, label: ColorLabel): void {
  const cur = ratings.get(path)?.label ?? "";
  setPhotoLabel(path, cur === label ? "" : label);
}

/** Apply the rating-or-label keyboard shortcut for `path`. Star keys
 * (`0`–`5`) set the rating to that exact value (idempotent: pressing
 * the same key again leaves the rating unchanged). Label keys
 * (`6`–`9`) toggle the corresponding color label off when it's
 * already set, otherwise replace whatever label was there. */
export function applyRatingShortcut(path: string, key: string): boolean {
  if (key >= "0" && key <= "5") {
    const stars = Number(key);
    setPhotoStars(path, stars);
    return true;
  }
  const label = KEY_TO_LABEL[key];
  if (label) {
    toggleLabel(path, label);
    return true;
  }
  return false;
}

export function subscribePhotoRatings(
  fn: (path: string) => void
): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(path: string) {
  for (const fn of listeners) fn(path);
}

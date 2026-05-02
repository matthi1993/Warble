/**
 * Per-photo non-destructive edit preferences. Mirrors `variant-store` but
 * for the `photo_edits` SQLite table.
 *
 * Edits are applied at render time on the canvas (sub-region drawing of
 * the cached `ImageBitmap`), NOT on the backend. So saving an edit is
 * just a DB write + a notify; the displayed bitmap is the same and we
 * never touch the bitmap cache.
 */
import { invoke } from "@tauri-apps/api/core";

export type AspectRatioKey =
  | "3:2"
  | "1:1"
  | "4:3"
  | "panavision"
  | "super-panavision";

export type Orientation = "landscape" | "portrait";

export interface CropEdit {
  /** Left edge as fraction of original width (0..1). */
  x: number;
  /** Top edge as fraction of original height (0..1). */
  y: number;
  /** Width as fraction of original width (0..1). */
  width: number;
  /** Height as fraction of original height (0..1). */
  height: number;
  /** Aspect-ratio preset that produced this crop (for UI restore). */
  aspectRatio: AspectRatioKey;
  /** Orientation that produced this crop (for UI restore). */
  orientation: Orientation;
}

export interface PhotoEdit {
  crop: CropEdit | null;
}

export const ASPECT_RATIO_VALUES: Record<AspectRatioKey, number> = {
  "3:2": 3 / 2,
  "1:1": 1,
  "4:3": 4 / 3,
  panavision: 2.35,
  "super-panavision": 2.76,
};

export const ASPECT_RATIO_LABELS: Record<AspectRatioKey, string> = {
  "3:2": "3:2",
  "1:1": "1:1",
  "4:3": "4:3",
  panavision: "Panavision",
  "super-panavision": "Super Panavision",
};

interface PersistedRow {
  path: string;
  crop: CropEdit | null;
}

const edits = new Map<string, PhotoEdit>();
const listeners = new Set<(path: string) => void>();
let loaded = false;
let loadPromise: Promise<void> | null = null;

export function loadPhotoEdits(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadPromise = invoke<PersistedRow[]>("get_photo_edits")
    .then((rows) => {
      for (const r of rows) {
        edits.set(r.path, { crop: r.crop ?? null });
      }
      loaded = true;
      notify("");
    })
    .catch((err) => {
      console.error("Failed to load photo edits", err);
      loaded = true;
    });
  return loadPromise;
}

export function getPhotoEdit(path: string): PhotoEdit | null {
  return edits.get(path) ?? null;
}

export function hasEdits(path: string): boolean {
  const e = edits.get(path);
  return !!e && !!e.crop;
}

/**
 * Persist a crop (or `null` to clear). Awaits the backend write so any
 * UI that reacts to `notify()` sees the freshly-persisted edit.
 */
export async function setPhotoCrop(
  path: string,
  crop: CropEdit | null
): Promise<void> {
  if (crop) {
    edits.set(path, { crop });
  } else {
    edits.delete(path);
  }
  try {
    await invoke(crop ? "set_photo_edit" : "clear_photo_edit", {
      path,
      crop: crop ?? null,
    });
  } catch (err) {
    console.error("Failed to persist photo edit", err);
  }
  notify(path);
}

export function subscribePhotoEdits(fn: (path: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(path: string) {
  for (const fn of listeners) fn(path);
}

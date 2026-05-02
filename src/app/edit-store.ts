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

/** Tonal adjustments under the "Basic" group in the editor side panel.
 *  All values are in [-100, 100] with `0` meaning "no change". */
export interface ToneEdit {
  exposure: number;
  contrast: number;
  saturation: number;
  whites: number;
  highlights: number;
  shadows: number;
  blacks: number;
}

export const TONE_KEYS: readonly (keyof ToneEdit)[] = [
  "exposure",
  "contrast",
  "saturation",
  "whites",
  "highlights",
  "shadows",
  "blacks",
] as const;

export function defaultTone(): ToneEdit {
  return {
    exposure: 0,
    contrast: 0,
    saturation: 0,
    whites: 0,
    highlights: 0,
    shadows: 0,
    blacks: 0,
  };
}

export function isToneZero(t: ToneEdit | null | undefined): boolean {
  if (!t) return true;
  for (const k of TONE_KEYS) {
    if (t[k] !== 0) return false;
  }
  return true;
}

export interface PhotoEdit {
  crop: CropEdit | null;
  tone: ToneEdit | null;
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
  tone: ToneEdit | null;
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
        edits.set(r.path, {
          crop: r.crop ?? null,
          tone: r.tone ?? null,
        });
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
  if (!e) return false;
  return !!e.crop || !isToneZero(e.tone);
}

function persistedTone(t: ToneEdit | null): ToneEdit | null {
  if (!t || isToneZero(t)) return null;
  return t;
}

async function persist(path: string): Promise<void> {
  const e = edits.get(path);
  const crop = e?.crop ?? null;
  const tone = persistedTone(e?.tone ?? null);
  try {
    if (!crop && !tone) {
      await invoke("clear_photo_edit", { path });
    } else {
      await invoke("set_photo_edit", { path, crop, tone });
    }
  } catch (err) {
    console.error("Failed to persist photo edit", err);
  }
}

/**
 * Coalesce rapid edits to the same photo into a single backend write.
 * A slider drag fires ~60 events/s; without this each one would queue
 * a Tauri IPC + SQLite write and stall the redraw loop. We snapshot
 * the latest in-memory state on a short timer instead.
 */
const PERSIST_DEBOUNCE_MS = 150;
const pendingPersists = new Map<string, number>();

function schedulePersist(path: string) {
  const existing = pendingPersists.get(path);
  if (existing !== undefined) window.clearTimeout(existing);
  const handle = window.setTimeout(() => {
    pendingPersists.delete(path);
    void persist(path);
  }, PERSIST_DEBOUNCE_MS);
  pendingPersists.set(path, handle);
}

/** Public: flush any pending debounced writes for `path` immediately.
 * Called when the editor closes or the photo is navigated away from
 * so we don't lose the last slider tick. */
export async function flushPhotoEdit(path: string): Promise<void> {
  const handle = pendingPersists.get(path);
  if (handle === undefined) return;
  window.clearTimeout(handle);
  pendingPersists.delete(path);
  await persist(path);
}

/**
 * Persist a crop (or `null` to clear). The in-memory store and
 * subscribers update synchronously so the canvas can repaint on the
 * same frame; the backend write happens in the background.
 */
export async function setPhotoCrop(
  path: string,
  crop: CropEdit | null
): Promise<void> {
  const prev = edits.get(path);
  const tone = prev?.tone ?? null;
  if (!crop && isToneZero(tone)) {
    edits.delete(path);
  } else {
    edits.set(path, { crop, tone });
  }
  notify(path);
  // Crop saves are user-initiated single events (Apply button); flush
  // any pending tone debounce and persist immediately so the caller
  // can await the actual DB write.
  await flushPhotoEdit(path);
  await persist(path);
}

/**
 * Persist a tone adjustment. `null` or all-zero clears the tone bucket
 * (and removes the row entirely if no crop is left either). The
 * in-memory write + subscriber notification are synchronous so a
 * slider drag produces an immediate redraw; the backend write is
 * debounced so a 60 Hz drag doesn't saturate the IPC channel.
 */
export function setPhotoTone(path: string, tone: ToneEdit | null): void {
  const prev = edits.get(path);
  const crop = prev?.crop ?? null;
  const cleaned = persistedTone(tone);
  if (!crop && !cleaned) {
    edits.delete(path);
  } else {
    edits.set(path, { crop, tone: cleaned });
  }
  notify(path);
  schedulePersist(path);
}

export function subscribePhotoEdits(fn: (path: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(path: string) {
  for (const fn of listeners) fn(path);
}

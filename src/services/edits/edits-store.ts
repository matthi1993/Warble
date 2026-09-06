/**
 * Per-photo non-destructive edit store. Mirrors `variant-store` but
 * for the `photo_edits` SQLite table.
 *
 * Edits are applied at render time on the canvas (sub-region drawing of
 * the cached `ImageBitmap`), NOT on the backend. So saving an edit is
 * just a DB write + a notify; the displayed bitmap is the same and we
 * never touch the bitmap cache.
 */
import { invoke } from "@tauri-apps/api/core";
import {
  type ColorEdit,
  type CropEdit,
  type CurveEdit,
  type PhotoEdit,
  type ToneEdit,
  isColorZero,
  isCurveZero,
  isToneZero,
  normalizeColor,
} from "@domain/edits";

interface PersistedRow {
  path: string;
  crop: CropEdit | null;
  tone: ToneEdit | null;
  curve: CurveEdit | null;
  color: ColorEdit | null;
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
          curve: r.curve ?? null,
          color: r.color ? normalizeColor(r.color) : null,
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

/** Drop all in-memory edits and re-fetch from the backend. Used
 *  after a library hot-swap so the new DB's edits are loaded. */
export function reloadPhotoEdits(): Promise<void> {
  edits.clear();
  loaded = false;
  loadPromise = null;
  return loadPhotoEdits();
}

export function getPhotoEdit(path: string): PhotoEdit | null {
  return edits.get(path) ?? null;
}

export function hasEdits(path: string): boolean {
  const e = edits.get(path);
  if (!e) return false;
  return (
    !!e.crop ||
    !isToneZero(e.tone) ||
    !isCurveZero(e.curve) ||
    !isColorZero(e.color)
  );
}

function persistedTone(t: ToneEdit | null): ToneEdit | null {
  if (!t || isToneZero(t)) return null;
  return t;
}

function persistedCurve(c: CurveEdit | null): CurveEdit | null {
  if (!c || isCurveZero(c)) return null;
  return c;
}

function persistedColor(c: ColorEdit | null): ColorEdit | null {
  if (!c || isColorZero(c)) return null;
  return c;
}

async function persist(path: string): Promise<void> {
  const e = edits.get(path);
  const crop = e?.crop ?? null;
  const tone = persistedTone(e?.tone ?? null);
  const curve = persistedCurve(e?.curve ?? null);
  const color = persistedColor(e?.color ?? null);
  if (!crop && !tone && !curve && !color) {
    await invoke("clear_photo_edit", { path });
  } else {
    await invoke("set_photo_edit", { path, crop, tone, curve, color });
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
const inFlightPersists = new Set<Promise<void>>();
const failedPersists = new Set<string>();

function runPersist(path: string): Promise<void> {
  const operation = persist(path);
  inFlightPersists.add(operation);
  void operation
    .then(
      () => { failedPersists.delete(path); },
      (err) => {
        failedPersists.add(path);
        console.error("Failed to persist photo edit", err);
      }
    )
    .finally(() => inFlightPersists.delete(operation));
  return operation;
}

function schedulePersist(path: string) {
  const existing = pendingPersists.get(path);
  if (existing !== undefined) window.clearTimeout(existing);
  const handle = window.setTimeout(() => {
    pendingPersists.delete(path);
    void runPersist(path);
  }, PERSIST_DEBOUNCE_MS);
  pendingPersists.set(path, handle);
}

/** Public: flush any pending debounced writes for `path` immediately.
 * Called when the editor closes or the photo is navigated away from
 * so we don't lose the last slider tick. */
export async function flushPhotoEdit(path: string): Promise<void> {
  const handle = pendingPersists.get(path);
  if (handle !== undefined) {
    window.clearTimeout(handle);
    pendingPersists.delete(path);
    await runPersist(path);
  }
  await Promise.allSettled([...inFlightPersists]);
  if (failedPersists.has(path)) await runPersist(path);
}

/** Flush every photo's pending edit before a library is copied or replaced. */
export async function flushAllPhotoEdits(): Promise<void> {
  if (loadPromise) await loadPromise;
  const paths = new Set(pendingPersists.keys());
  for (const handle of pendingPersists.values()) window.clearTimeout(handle);
  pendingPersists.clear();

  await Promise.allSettled([...inFlightPersists]);
  for (const path of failedPersists) paths.add(path);
  await Promise.all([...paths].map((path) => runPersist(path)));
}

function snapshot(path: string): {
  crop: CropEdit | null;
  tone: ToneEdit | null;
  curve: CurveEdit | null;
  color: ColorEdit | null;
} {
  const prev = edits.get(path);
  return {
    crop: prev?.crop ?? null,
    tone: prev?.tone ?? null,
    curve: prev?.curve ?? null,
    color: prev?.color ?? null,
  };
}

function commit(path: string, next: PhotoEdit) {
  const empty =
    !next.crop &&
    isToneZero(next.tone) &&
    isCurveZero(next.curve) &&
    isColorZero(next.color);
  if (empty) {
    edits.delete(path);
  } else {
    edits.set(path, next);
  }
  notify(path);
  schedulePersist(path);
}

/**
 * Persist a crop (or `null` to clear). The in-memory store and
 * subscribers update synchronously so the canvas can repaint on the
 * same frame; the backend write happens on a debounce so dragging
 * crop handles doesn't saturate the IPC channel.
 */
export function setPhotoCrop(
  path: string,
  crop: CropEdit | null,
): void {
  const s = snapshot(path);
  commit(path, { crop, tone: s.tone, curve: s.curve, color: s.color });
}

/**
 * Persist a tone adjustment. `null` or all-zero clears the tone bucket
 * (and removes the row entirely if no crop is left either). The
 * in-memory write + subscriber notification are synchronous so a
 * slider drag produces an immediate redraw; the backend write is
 * debounced so a 60 Hz drag doesn't saturate the IPC channel.
 */
export function setPhotoTone(path: string, tone: ToneEdit | null): void {
  const s = snapshot(path);
  commit(path, {
    crop: s.crop,
    tone: persistedTone(tone),
    curve: s.curve,
    color: s.color,
  });
}

/**
 * Persist a tone curve. Same in-memory-sync / IPC-debounce pattern as
 * `setPhotoTone`. Pass `null` (or an all-identity curve) to clear.
 */
export function setPhotoCurve(
  path: string,
  curve: CurveEdit | null,
): void {
  const s = snapshot(path);
  commit(path, {
    crop: s.crop,
    tone: s.tone,
    curve: persistedCurve(curve),
    color: s.color,
  });
}

/**
 * Persist per-photo color (HSL) adjustments. Same in-memory-sync /
 * IPC-debounce pattern as the others. Pass `null` (or a fully-neutral
 * `ColorEdit`) to clear.
 */
export function setPhotoColor(
  path: string,
  color: ColorEdit | null,
): void {
  const s = snapshot(path);
  commit(path, {
    crop: s.crop,
    tone: s.tone,
    curve: s.curve,
    color: persistedColor(color),
  });
}

export function subscribePhotoEdits(fn: (path: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(path: string) {
  for (const fn of listeners) fn(path);
}

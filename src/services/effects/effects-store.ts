/**
 * Per-photo effects store.
 *
 * Effects are non-destructive per-photo edits applied on the canvas
 * at draw time, like the entries in `edits-store`. They are kept in
 * a separate store and persisted as one JSON value in the active
 * library's SQLite settings table.
 *
 * Shape is intentionally `Record<toolId, settings>` so a new effect
 * is just another key — no migrations needed unless an existing
 * effect changes its own shape.
 */

import { invoke } from "@tauri-apps/api/core";

/** Unsharp-mask sharpening. Applied as a per-photo effect (with a
 *  format-aware default — RAW gets a light pass, JPG gets nothing)
 *  and reused as a separate global pass by the post-process layer.
 *
 *  The shader builds a blurred copy of the source at a mip level
 *  proportional to `radius`, subtracts it from the source to get a
 *  high-pass mask, gates the mask by `threshold` (so flat regions
 *  / noise are spared), and adds `strength` × mask back to the
 *  source. Standard unsharp-mask math. */
export interface SharpenSettings {
  /** 0..200 — overall amount of high-frequency contrast added
   *  back. 0 disables the sharpening pass entirely. 100 maps to
   *  a moderate Lightroom-style boost. */
  strength: number;
  /** 0.3..3 — radius of the blur used to build the high-pass
   *  mask, in source pixels. Smaller values target only the
   *  finest detail; larger values create halos around edges. */
  radius: number;
  /** 0..50 — minimum local contrast (0–255 luminance delta) that
   *  must be exceeded before a pixel is sharpened. Protects skin
   *  / sky / sensor noise from being amplified. */
  threshold: number;
}

export interface GrainSettings {
  /** 0.1..100 — diameter of the organic grain. Post-process grain is
   * interpreted in normalised image space, not source pixels. */
  size: number;
  /** 0..100 — strength of the organic, softly-shaped film grain. */
  amount: number;
  /** 0..100 — strength of the additional monochrome per-pixel noise. */
  fine: number;
}

export interface BloomSettings {
  /** 0..100 — final light-spill amount. */
  strength: number;
  /** 0..100 — luminance at which pixels begin emitting. */
  threshold: number;
  /** 0..100 — radius of the three-scale blur pyramid. */
  radius: number;
  /** 0..100 — width of the soft bright-pixel gate. */
  softness: number;
  /** 0..100 — balance from tight detail to broad atmosphere. */
  spread: number;
}

export function defaultBloom(): BloomSettings {
  return { strength: 0, threshold: 68, radius: 50, softness: 45, spread: 60 };
}

export function isBloomZero(bloom: BloomSettings | null | undefined): boolean {
  return !bloom || bloom.strength <= 0;
}

export function defaultGrain(): GrainSettings {
  return { size: 25, amount: 0, fine: 0 };
}

export function isGrainZero(
  grain: GrainSettings | null | undefined
): boolean {
  return !grain || (grain.amount <= 0 && grain.fine <= 0);
}

export interface PhotoEffects {
  /** `null` means "no per-photo override stored" — the canvas
   *  falls back to a format-aware default (see
   *  {@link defaultSharpenForFormat}). An explicit
   *  `SharpenSettings` (even one with `strength: 0`) is treated
   *  as a deliberate user choice and overrides the default. */
  sharpen: SharpenSettings | null;
  /** Explicit per-photo grain override. `null` is the zero-grain default. */
  grain: GrainSettings | null;
}

const LEGACY_STORAGE_KEY = "warble.effects.v1";

/** Sensible "no sharpening" baseline. Radius / threshold are kept
 *  at the values the per-format defaults use so toggling strength
 *  on doesn't snap the other sliders to weird positions. */
export function defaultSharpen(): SharpenSettings {
  return { strength: 0, radius: 1, threshold: 0 };
}

/** Per-format starting point for the per-photo sharpen card. RAW
 *  files arrive un-sharpened from the demosaic pipeline and benefit
 *  from a light pass — Lightroom ships ~40 strength / 1.0 radius /
 *  0 threshold for the same reason. JPGs already carry whatever
 *  sharpening the camera applied, so we default to off. */
export function defaultSharpenForFormat(
  format: "jpg" | "raw" | null | undefined
): SharpenSettings {
  if (format === "raw") {
    return { strength: 40, radius: 1, threshold: 0 };
  }
  return defaultSharpen();
}

export function isSharpenZero(
  s: SharpenSettings | null | undefined
): boolean {
  return !s || s.strength <= 0;
}

type Listener = (path: string) => void;

const effects = new Map<string, PhotoEffects>();
const listeners = new Set<Listener>();

function applySerialized(raw: string): void {
  try {
    const parsed = JSON.parse(raw) as Record<
      string,
      {
        bloom?: unknown;
        blur?: unknown;
        sharpen?: SharpenSettings | null;
        grain?: GrainSettings | null;
      }
    >;
    for (const [path, e] of Object.entries(parsed)) {
      const effect: PhotoEffects = {
        sharpen: e.sharpen
          ? { ...defaultSharpen(), ...e.sharpen }
          : null,
        grain: e.grain ? { ...defaultGrain(), ...e.grain } : null,
      };
      if (effect.sharpen || effect.grain) effects.set(path, effect);
    }
  } catch (err) {
    console.warn("effects: invalid persisted settings, resetting", err);
  }
}

function loadLegacy(): void {
  if (typeof localStorage === "undefined") return;
  const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (raw) applySerialized(raw);
}

function serialize(): string {
  const value: Record<string, PhotoEffects> = {};
  for (const [path, effect] of effects.entries()) {
    if (effect.sharpen || effect.grain) value[path] = effect;
  }
  return JSON.stringify(value);
}

let loaded = false;
let loadPromise: Promise<void> | null = null;
let loadGeneration = 0;
let persistTimer: number | null = null;
let persistChain: Promise<void> = Promise.resolve();
let persistError: unknown = null;

function persistNow(): Promise<void> {
  const effectsJson = serialize();
  const operation = persistChain.then(() =>
    invoke<void>("set_photo_effects", { effectsJson })
  );
  persistChain = operation.then(
    () => { persistError = null; },
    (err) => {
      persistError = err;
      console.warn("effects: failed to persist", err);
    }
  );
  return operation;
}

function schedulePersist(): void {
  if (persistTimer !== null) window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    void persistNow().catch(() => {});
  }, 150);
}

async function hydrate(migrateLegacy: boolean): Promise<void> {
  const generation = loadGeneration;
  try {
    const raw = await invoke<string | null>("get_photo_effects");
    if (generation !== loadGeneration) return;
    if (raw !== null) {
      effects.clear();
      applySerialized(raw);
    } else if (migrateLegacy && effects.size > 0) {
      await persistNow();
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    } else {
      effects.clear();
    }
  } catch (err) {
    console.warn("effects: failed to load", err);
  } finally {
    if (generation === loadGeneration) {
      loaded = true;
      notify("");
    }
  }
}

loadLegacy();

/** Hydrate per-photo grain and sharpening from the active library. */
export function loadPhotoEffects(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (!loadPromise) loadPromise = hydrate(true);
  return loadPromise;
}

/** Replace in-memory effects after a folder-sidecar rescan. */
export function reloadPhotoEffects(): Promise<void> {
  loadGeneration += 1;
  loaded = false;
  loadPromise = null;
  effects.clear();
  notify("");
  loadPromise = hydrate(false);
  return loadPromise;
}

/** Flush the slider debounce before a media root is disconnected. */
export async function flushPhotoEffects(): Promise<void> {
  if (loadPromise) await loadPromise;
  if (persistTimer !== null) {
    window.clearTimeout(persistTimer);
    persistTimer = null;
    void persistNow().catch(() => {});
  }
  await persistChain;
  if (persistError) await persistNow();
}

function notify(path: string): void {
  for (const l of listeners) l(path);
}

export function getPhotoEffects(path: string): PhotoEffects | null {
  return effects.get(path) ?? null;
}

/** Read the explicitly-stored sharpen settings for `path`. Returns
 *  `null` if the user has never touched the slider — callers that
 *  need a renderable value should fall back to
 *  {@link defaultSharpenForFormat}. */
export function getPhotoSharpen(path: string | null): SharpenSettings | null {
  if (!path) return null;
  return effects.get(path)?.sharpen ?? null;
}

/** Store an explicit per-photo sharpen override. We
 *  KEEP `strength: 0` rather than collapsing to `null`, because a
 *  user-zeroed value must beat the format default (otherwise
 *  disabling sharpening on a RAW would silently re-enable it on
 *  the next reload). Pass `null` to clear the override and fall
 *  back to {@link defaultSharpenForFormat}. */
export function setPhotoSharpen(
  path: string,
  sharpen: SharpenSettings | null
): void {
  const cleaned = sharpen ? { ...sharpen } : null;
  const existing = effects.get(path);
  if (cleaned) {
    effects.set(path, {
      ...(existing ?? { sharpen: null, grain: null }),
      sharpen: cleaned,
    });
  } else if (existing) {
    if (existing.sharpen == null) return;
    const next: PhotoEffects = { ...existing, sharpen: null };
    if (!next.sharpen && !next.grain) effects.delete(path);
    else effects.set(path, next);
  } else {
    return;
  }
  schedulePersist();
  notify(path);
}

export function getPhotoGrain(path: string | null): GrainSettings | null {
  if (!path) return null;
  return effects.get(path)?.grain ?? null;
}

export function setPhotoGrain(
  path: string,
  grain: GrainSettings | null
): void {
  const cleaned = grain ? { ...defaultGrain(), ...grain } : null;
  const existing = effects.get(path);
  if (cleaned) {
    effects.set(path, {
      ...(existing ?? { sharpen: null, grain: null }),
      grain: cleaned,
    });
  } else if (existing) {
    if (existing.grain == null) return;
    const next: PhotoEffects = { ...existing, grain: null };
    if (!next.sharpen && !next.grain) effects.delete(path);
    else effects.set(path, next);
  } else {
    return;
  }
  schedulePersist();
  notify(path);
}

export function hasEffects(path: string): boolean {
  const e = effects.get(path);
  if (!e) return false;
  return e.sharpen != null || e.grain != null;
}

/** Drop effects belonging to a media root before that root is forgotten. */
export function removePhotoEffectsUnderRoot(rootId: string): void {
  let changed = false;
  for (const path of effects.keys()) {
    if (path === rootId || path.startsWith(`${rootId}/`)) {
      effects.delete(path);
      changed = true;
    }
  }
  if (changed) {
    schedulePersist();
    notify("");
  }
}

export function subscribePhotoEffects(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

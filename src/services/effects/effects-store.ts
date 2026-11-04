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
import {
  normalizeAnalog, normalizeClarity, type AnalogSettings, defaultGrain, defaultSharpen, type ClaritySettings, type GrainSettings, type SharpenSettings,
} from "@domain/edits";
export {
  defaultBloom, defaultGrain, defaultSharpen, isBloomZero,
  isGrainZero, isSharpenZero,
} from "@domain/edits";
export type { BloomSettings, GrainSettings, SharpenSettings } from "@domain/edits";

export interface PhotoEffects {
  /** `null` means "no per-photo override stored" — the canvas
   *  falls back to the default. An explicit
   *  `SharpenSettings` (even one with `strength: 0`) is treated
   *  as a deliberate user choice and overrides the default. */
  sharpen: SharpenSettings | null;
  clarity: ClaritySettings | null;
  analog: AnalogSettings | null;
  /** Explicit per-photo grain override. `null` is the zero-grain default. */
  grain: GrainSettings | null;
}

const LEGACY_STORAGE_KEY = "warble.effects.v1";

type Listener = (path: string) => void;

const effects = new Map<string, PhotoEffects>();
const listeners = new Set<Listener>();

function applySerialized(raw: string): void {
  try {
    const parsed = JSON.parse(raw) as Record<
      string,
      {
        clarity?: ClaritySettings | null;
        analog?: AnalogSettings | null;
        sharpen?: SharpenSettings | null;
        grain?: GrainSettings | null;
      }
    >;
    for (const [path, e] of Object.entries(parsed)) {
      const effect: PhotoEffects = {
        clarity: e.clarity ? normalizeClarity(e.clarity) : null,
        analog: e.analog ? normalizeAnalog(e.analog) : null,
        sharpen: e.sharpen
          ? { ...defaultSharpen(), ...e.sharpen }
          : null,
        grain: e.grain ? { ...defaultGrain(), ...e.grain } : null,
      };
      if (Object.values(effect).some(Boolean)) effects.set(path, effect);
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
    if (Object.values(effect).some(Boolean)) value[path] = effect;
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

/** Hydrate per-photo effects from the active library. */
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
 *  {@link defaultSharpen}. */
export function getPhotoSharpen(path: string | null): SharpenSettings | null {
  if (!path) return null;
  return effects.get(path)?.sharpen ?? null;
}

function setPhotoEffect<K extends keyof PhotoEffects>(path: string, key: K, value: PhotoEffects[K]): void {
  const existing = effects.get(path);
  if (!value && !existing?.[key]) return;
  const next: PhotoEffects = { sharpen: null, grain: null, clarity: null, analog: null, ...existing, [key]: value };
  if (Object.values(next).some(Boolean)) effects.set(path, next);
  else effects.delete(path);
  schedulePersist();
  notify(path);
}

export function setPhotoSharpen(path: string, value: SharpenSettings | null): void {
  setPhotoEffect(path, "sharpen", value ? { ...defaultSharpen(), ...value } : null);
}

export function getPhotoGrain(path: string | null): GrainSettings | null {
  return path ? effects.get(path)?.grain ?? null : null;
}

export function setPhotoGrain(path: string, value: GrainSettings | null): void {
  setPhotoEffect(path, "grain", value ? { ...defaultGrain(), ...value } : null);
}

export function getPhotoClarity(path: string | null): ClaritySettings | null {
  return path ? effects.get(path)?.clarity ?? null : null;
}

export function setPhotoClarity(path: string, value: ClaritySettings | null): void {
  setPhotoEffect(path, "clarity", value ? normalizeClarity(value) : null);
}

export function getPhotoAnalog(path: string | null): AnalogSettings | null {
  return path ? effects.get(path)?.analog ?? null : null;
}

export function setPhotoAnalog(path: string, value: AnalogSettings | null): void {
  setPhotoEffect(path, "analog", value ? normalizeAnalog(value) : null);
}

export function hasEffects(path: string): boolean {
  const effect = effects.get(path);
  return !!effect && Object.values(effect).some(Boolean);
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

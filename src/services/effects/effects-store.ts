/**
 * Per-photo effects store.
 *
 * Effects (bloom, future tools) are non-destructive per-photo edits
 * applied on the canvas at draw time, like the entries in
 * `edits-store`. They are kept in a separate store because they
 * don't yet have Rust-side persistence — we avoid touching the
 * SQLite schema by keeping the whole table in `localStorage`. If the
 * effects feature graduates to a first-class edit, this file is the
 * single place that has to migrate into `edits-store`.
 *
 * Shape is intentionally `Record<toolId, settings>` so a new effect
 * (sharpen, vignette, …) is just another key — no migrations needed
 * unless an existing effect changes its own shape.
 */

export interface BloomSettings {
  /** 0..300 — master strength of the bloom add. 0 disables the
   *  bloom pass entirely. Values above 100 deliberately overdrive
   *  the highlights for a dreamy / blown-out look. */
  strength: number;
  /** 1..200 — radius of the highlight glow in source pixels. */
  size: number;
  /** 0..100 — luminance threshold (as a percentage). Pixels at or
   *  below this brightness contribute nothing to the bloom; brighter
   *  pixels bloom proportionally above it. */
  threshold: number;
}

export interface PhotoEffects {
  bloom: BloomSettings | null;
}

const STORAGE_KEY = "warble.effects.v1";

export function defaultBloom(): BloomSettings {
  return { strength: 0, size: 12, threshold: 70 };
}

export function isBloomZero(b: BloomSettings | null | undefined): boolean {
  return !b || b.strength <= 0;
}

type Listener = (path: string) => void;

const effects = new Map<string, PhotoEffects>();
const listeners = new Set<Listener>();

function load(): void {
  if (typeof localStorage === "undefined") return;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Record<
      string,
      // Legacy `blur` key tolerated for one-time migration from
      // the previous bilateral-blur prototype.
      { bloom?: BloomSettings | null; blur?: BloomSettings | null }
    >;
    for (const [path, e] of Object.entries(parsed)) {
      const src = e.bloom ?? e.blur ?? null;
      effects.set(path, {
        bloom: src ? { ...defaultBloom(), ...src } : null,
      });
    }
  } catch (err) {
    console.warn("effects: invalid persisted settings, resetting", err);
  }
}

let saveScheduled = false;
function save(): void {
  if (saveScheduled || typeof localStorage === "undefined") return;
  saveScheduled = true;
  // Debounce one tick — same shape of write storm as edits-store
  // when the user drags a slider.
  queueMicrotask(() => {
    saveScheduled = false;
    try {
      const obj: Record<string, PhotoEffects> = {};
      for (const [path, e] of effects.entries()) {
        if (e.bloom) obj[path] = e;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch (err) {
      console.warn("effects: failed to persist", err);
    }
  });
}

load();

function notify(path: string): void {
  for (const l of listeners) l(path);
}

export function getPhotoEffects(path: string): PhotoEffects | null {
  return effects.get(path) ?? null;
}

export function getPhotoBloom(path: string | null): BloomSettings | null {
  if (!path) return null;
  return effects.get(path)?.bloom ?? null;
}

export function setPhotoBloom(
  path: string,
  bloom: BloomSettings | null
): void {
  const cleaned = bloom && !isBloomZero(bloom) ? { ...bloom } : null;
  const existing = effects.get(path);
  if (cleaned) {
    effects.set(path, { ...(existing ?? { bloom: null }), bloom: cleaned });
  } else if (existing) {
    if (existing.bloom == null) return;
    const next: PhotoEffects = { ...existing, bloom: null };
    if (!next.bloom) effects.delete(path);
    else effects.set(path, next);
  } else {
    return;
  }
  save();
  notify(path);
}

export function hasEffects(path: string): boolean {
  const e = effects.get(path);
  return !!e && !isBloomZero(e.bloom);
}

export function subscribePhotoEffects(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

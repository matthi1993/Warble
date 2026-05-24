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

export interface PhotoEffects {
  bloom: BloomSettings | null;
  /** `null` means "no per-photo override stored" — the canvas
   *  falls back to a format-aware default (see
   *  {@link defaultSharpenForFormat}). An explicit
   *  `SharpenSettings` (even one with `strength: 0`) is treated
   *  as a deliberate user choice and overrides the default. */
  sharpen: SharpenSettings | null;
}

const STORAGE_KEY = "warble.effects.v1";

export function defaultBloom(): BloomSettings {
  return { strength: 0, size: 12, threshold: 70 };
}

export function isBloomZero(b: BloomSettings | null | undefined): boolean {
  return !b || b.strength <= 0;
}

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

function load(): void {
  if (typeof localStorage === "undefined") return;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Record<
      string,
      // Legacy `blur` key tolerated for one-time migration from
      // the previous bilateral-blur prototype.
      {
        bloom?: BloomSettings | null;
        blur?: BloomSettings | null;
        sharpen?: SharpenSettings | null;
      }
    >;
    for (const [path, e] of Object.entries(parsed)) {
      const src = e.bloom ?? e.blur ?? null;
      effects.set(path, {
        bloom: src ? { ...defaultBloom(), ...src } : null,
        sharpen: e.sharpen
          ? { ...defaultSharpen(), ...e.sharpen }
          : null,
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
        if (e.bloom || e.sharpen) obj[path] = e;
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
    effects.set(path, {
      ...(existing ?? { bloom: null, sharpen: null }),
      bloom: cleaned,
    });
  } else if (existing) {
    if (existing.bloom == null) return;
    const next: PhotoEffects = { ...existing, bloom: null };
    if (!next.bloom && !next.sharpen) effects.delete(path);
    else effects.set(path, next);
  } else {
    return;
  }
  save();
  notify(path);
}

/** Read the explicitly-stored sharpen settings for `path`. Returns
 *  `null` if the user has never touched the slider — callers that
 *  need a renderable value should fall back to
 *  {@link defaultSharpenForFormat}. */
export function getPhotoSharpen(path: string | null): SharpenSettings | null {
  if (!path) return null;
  return effects.get(path)?.sharpen ?? null;
}

/** Store an explicit per-photo sharpen override. Unlike bloom we
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
      ...(existing ?? { bloom: null, sharpen: null }),
      sharpen: cleaned,
    });
  } else if (existing) {
    if (existing.sharpen == null) return;
    const next: PhotoEffects = { ...existing, sharpen: null };
    if (!next.bloom && !next.sharpen) effects.delete(path);
    else effects.set(path, next);
  } else {
    return;
  }
  save();
  notify(path);
}

export function hasEffects(path: string): boolean {
  const e = effects.get(path);
  if (!e) return false;
  return !isBloomZero(e.bloom) || e.sharpen != null;
}

export function subscribePhotoEffects(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

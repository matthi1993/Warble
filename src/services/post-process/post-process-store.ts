/**
 * Global post-process store.
 *
 * Post-process settings (grain + post tone curve) are applied AFTER
 * the per-photo edit pipeline (tone + edit-curve) at draw time. They
 * are intentionally NOT per-photo: the user picks a look they like
 * and it sticks across every image until they change it. That makes
 * post-process effects feel like a film stock / camera profile
 * rather than a one-off correction.
 *
 * Persistence: `localStorage` (no Tauri round-trip needed). The store
 * publishes a synchronous in-memory snapshot via `getPostProcess()`
 * and notifies subscribers on every write.
 */

import { defaultCurve, type CurveEdit } from "@domain/edits";

export interface GrainSettings {
  /** 0..100 — master intensity for the grain layer. 0 disables the
   *  grain pass entirely. Acts as the headline "how much film look"
   *  knob: it scales grain amplitude and (mildly) influences how
   *  much chroma noise is mixed in. */
  amount: number;
  /** 0.5..5 — grain cell size in virtual-film-plane units. Larger
   *  values give coarser, chunkier grain (high-ISO push-process
   *  look); smaller values give micro-grain (slow-speed film). */
  size: number;
  /** Seed for the pseudo-random hash. Bumping this re-rolls the
   *  grain pattern without changing any of the intensity knobs. */
  seed: number;
}

export interface PostProcessSettings {
  /** Master switch. When false, the canvas skips the post pipeline
   *  entirely and just shows the per-photo edits. UI controls
   *  remain editable so users can audition a look without seeing
   *  it applied. */
  enabled: boolean;
  grain: GrainSettings;
  curve: CurveEdit;
}

const STORAGE_KEY = "warble.postProcess.v1";

function defaultGrain(): GrainSettings {
  return {
    amount: 0,
    size: 1.5,
    seed: 1,
  };
}

function defaultSettings(): PostProcessSettings {
  return { enabled: true, grain: defaultGrain(), curve: defaultCurve() };
}

function load(): PostProcessSettings {
  if (typeof localStorage === "undefined") return defaultSettings();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultSettings();
  try {
    // Legacy keys we migrate from older versions of the schema:
    //  - iso  (0..3200) -> amount (0..100), via iso/32.
    //  - dust, scratches, hair, flicker, strength -> dropped (older
    //    film-scan artifact knobs that were removed).
    type LegacyGrain = Partial<GrainSettings> & {
      iso?: number;
      hair?: number;
      flicker?: number;
      strength?: number;
      dust?: number;
      scratches?: number;
    };
    const parsed = JSON.parse(raw) as Partial<PostProcessSettings> & {
      grain?: LegacyGrain;
    };
    const g: LegacyGrain = parsed.grain ?? {};
    const migrated: Partial<GrainSettings> = {
      amount: g.amount,
      size: g.size,
      seed: g.seed,
    };
    if (g.amount === undefined && typeof g.iso === "number") {
      migrated.amount = Math.min(100, Math.max(0, g.iso / 32));
    }
    return {
      enabled: parsed.enabled ?? true,
      grain: { ...defaultGrain(), ...migrated },
      curve: parsed.curve ?? defaultCurve(),
    };
  } catch (err) {
    console.warn("post-process: invalid persisted settings, resetting", err);
    return defaultSettings();
  }
}

function save(s: PostProcessSettings): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch (err) {
    console.warn("post-process: failed to persist settings", err);
  }
}

let current: PostProcessSettings = load();
const listeners = new Set<(s: PostProcessSettings) => void>();

export function getPostProcess(): PostProcessSettings {
  return current;
}

/** Toggle the master post-process switch. Settings are preserved
 *  so the user can flip back on and get the same look. */
export function setPostProcessEnabled(enabled: boolean): void {
  if (current.enabled === enabled) return;
  current = { ...current, enabled };
  save(current);
  notify();
}

export function setGrain(grain: Partial<GrainSettings>): void {
  current = { ...current, grain: { ...current.grain, ...grain } };
  save(current);
  notify();
}

export function setPostCurve(curve: CurveEdit): void {
  current = { ...current, curve };
  save(current);
  notify();
}

export function resetPostProcess(): void {
  current = defaultSettings();
  save(current);
  notify();
}

/** Reset only the grain settings — leaves the post curve untouched. */
export function resetGrain(): void {
  current = { ...current, grain: defaultGrain() };
  save(current);
  notify();
}

/** Reset only the post-process curve — leaves grain untouched. */
export function resetPostCurve(): void {
  current = { ...current, curve: defaultCurve() };
  save(current);
  notify();
}

export function subscribePostProcess(
  fn: (s: PostProcessSettings) => void
): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  for (const fn of listeners) fn(current);
}

export { defaultGrain, defaultSettings as defaultPostProcess };

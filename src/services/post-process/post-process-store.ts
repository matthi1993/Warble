/**
 * Global post-process store.
 *
 * Post-process settings (color, curve, sharpening, and grain) are applied
 * AFTER the per-photo edit pipeline (tone + edit-color + edit-curve) at
 * draw time. They are intentionally NOT per-photo: the user picks a
 * look they like and it sticks across every image until they change
 * it. That makes post-process effects feel like a film stock /
 * camera profile rather than a one-off correction.
 *
 * Persistence: `localStorage` (no Tauri round-trip needed). The store
 * publishes a synchronous in-memory snapshot via `getPostProcess()`
 * and notifies subscribers on every write.
 */

import {
  defaultColor,
  defaultCurve,
  normalizeColor,
  type ColorEdit,
  type CurveEdit,
} from "@domain/edits";
import {
  defaultGrain,
  defaultSharpen,
  type GrainSettings,
  type SharpenSettings,
} from "@services/effects/effects-store";

export { defaultGrain, isGrainZero } from "@services/effects/effects-store";
export type { GrainSettings } from "@services/effects/effects-store";

export interface PostProcessSettings {
  /** Master switch. When false, the canvas skips the post pipeline
   *  entirely and just shows the per-photo edits. UI controls
   *  remain editable so users can audition a look without seeing
   *  it applied. */
  enabled: boolean;
  color: ColorEdit;
  curve: CurveEdit;
  /** Global sharpening pass applied AFTER per-photo edits and the
   *  post color + curve. Defaults to zero strength so existing
   *  installs upgrade silently. */
  sharpen: SharpenSettings;
  /** Resolution-independent film grain plus optional per-pixel noise. */
  grain: GrainSettings;
}

const STORAGE_KEY = "warble.postProcess.v3";

function defaultSettings(): PostProcessSettings {
  return {
    enabled: true,
    color: defaultColor(),
    curve: defaultCurve(),
    sharpen: defaultSharpen(),
    grain: defaultGrain(),
  };
}

function load(): PostProcessSettings {
  if (typeof localStorage === "undefined") return defaultSettings();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultSettings();
  try {
    const parsed = JSON.parse(raw) as Partial<PostProcessSettings>;
    return {
      enabled: parsed.enabled ?? true,
      color: parsed.color ? normalizeColor(parsed.color) : defaultColor(),
      curve: parsed.curve ?? defaultCurve(),
      sharpen: parsed.sharpen
        ? { ...defaultSharpen(), ...parsed.sharpen }
        : defaultSharpen(),
      grain: parsed.grain
        ? { ...defaultGrain(), ...parsed.grain }
        : defaultGrain(),
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
let previewBase: PostProcessSettings | null = null;
const listeners = new Set<(s: PostProcessSettings) => void>();

export function getPostProcess(): PostProcessSettings {
  return current;
}

/** The persisted state underneath a hover preview. Preset saving uses this
 * so a transient preview can never accidentally become a new preset. */
export function getCommittedPostProcess(): PostProcessSettings {
  return previewBase ?? current;
}

function commit(next: PostProcessSettings): void {
  previewBase = null;
  current = next;
  save(current);
  notify();
}

/** Replace every post-processing tool value in one atomic update. */
export function setPostProcess(settings: PostProcessSettings): void {
  commit(structuredClone(settings));
}

/** Apply a non-persisted state while the pointer is over a preset. */
export function previewPostProcess(settings: PostProcessSettings): void {
  if (!previewBase) previewBase = current;
  current = structuredClone(settings);
  notify();
}

export function clearPostProcessPreview(): void {
  if (!previewBase) return;
  current = previewBase;
  previewBase = null;
  notify();
}

/** Toggle the master post-process switch. Settings are preserved
 *  so the user can flip back on and get the same look. */
export function setPostProcessEnabled(enabled: boolean): void {
  const base = getCommittedPostProcess();
  if (base.enabled === enabled) {
    clearPostProcessPreview();
    return;
  }
  commit({ ...base, enabled });
}

export function setPostColor(color: ColorEdit): void {
  commit({ ...getCommittedPostProcess(), color });
}

export function setPostCurve(curve: CurveEdit): void {
  commit({ ...getCommittedPostProcess(), curve });
}

export function setPostSharpen(sharpen: SharpenSettings): void {
  commit({ ...getCommittedPostProcess(), sharpen });
}

export function resetPostSharpen(): void {
  commit({ ...getCommittedPostProcess(), sharpen: defaultSharpen() });
}

export function setPostGrain(grain: GrainSettings): void {
  commit({ ...getCommittedPostProcess(), grain });
}

export function resetPostGrain(): void {
  commit({ ...getCommittedPostProcess(), grain: defaultGrain() });
}

export function resetPostProcess(): void {
  commit(defaultSettings());
}

/** Reset only the post-process color — leaves the post curve untouched. */
export function resetPostColor(): void {
  commit({ ...getCommittedPostProcess(), color: defaultColor() });
}

/** Reset only the post-process curve — leaves color untouched. */
export function resetPostCurve(): void {
  commit({ ...getCommittedPostProcess(), curve: defaultCurve() });
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

export { defaultSettings as defaultPostProcess };

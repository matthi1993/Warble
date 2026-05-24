/**
 * Global post-process store.
 *
 * Post-process settings (color + post tone curve) are applied AFTER
 * the per-photo edit pipeline (tone + edit-color + edit-curve) at
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
  type ColorEdit,
  type CurveEdit,
} from "@domain/edits";
import {
  defaultSharpen,
  type SharpenSettings,
} from "@services/effects/effects-store";

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
}

const STORAGE_KEY = "warble.postProcess.v3";

function defaultSettings(): PostProcessSettings {
  return {
    enabled: true,
    color: defaultColor(),
    curve: defaultCurve(),
    sharpen: defaultSharpen(),
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
      color: parsed.color ?? defaultColor(),
      curve: parsed.curve ?? defaultCurve(),
      sharpen: parsed.sharpen
        ? { ...defaultSharpen(), ...parsed.sharpen }
        : defaultSharpen(),
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

export function setPostColor(color: ColorEdit): void {
  current = { ...current, color };
  save(current);
  notify();
}

export function setPostCurve(curve: CurveEdit): void {
  current = { ...current, curve };
  save(current);
  notify();
}

export function setPostSharpen(sharpen: SharpenSettings): void {
  current = { ...current, sharpen };
  save(current);
  notify();
}

export function resetPostSharpen(): void {
  current = { ...current, sharpen: defaultSharpen() };
  save(current);
  notify();
}

export function resetPostProcess(): void {
  current = defaultSettings();
  save(current);
  notify();
}

/** Reset only the post-process color — leaves the post curve untouched. */
export function resetPostColor(): void {
  current = { ...current, color: defaultColor() };
  save(current);
  notify();
}

/** Reset only the post-process curve — leaves color untouched. */
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

export { defaultSettings as defaultPostProcess };

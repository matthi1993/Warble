/**
 * Cross-component cache + persistence for the user's per-photo
 * (format, variant) choice. The detail panel and the full view both
 * read/write this store so a selection made in one view shows up in
 * the other, and survives across launches via the SQLite-backed
 * `photo_variants` table.
 */
import { invoke } from "@tauri-apps/api/core";
import type { PhotoFormat } from "@domain/photo";

export interface VariantPref {
  format: PhotoFormat;
  variant: string;
}

interface PersistedRow {
  path: string;
  format: string;
  variant: string;
}

const overrides = new Map<string, VariantPref>();
/** RAW is a temporary working selection. Keep the most recently selected
 * JPEG separately so navigation can restore it without losing the user's
 * variant choice. */
const lastJpegOverrides = new Map<string, VariantPref>();
const sessionOverrides = new Set<string>();
const listeners = new Set<() => void>();
let loaded = false;
let loadPromise: Promise<void> | null = null;

function isFormat(s: string): s is PhotoFormat {
  return s === "jpg" || s === "raw";
}

/** Hydrate the in-memory map from the backend. Idempotent. */
export function loadVariantOverrides(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadPromise = invoke<PersistedRow[]>("get_photo_variants")
    .then((rows) => {
      for (const r of rows) {
        if (!isFormat(r.format)) continue;
        const pref = { format: r.format, variant: r.variant };
        overrides.set(r.path, pref);
        if (pref.format === "jpg") lastJpegOverrides.set(r.path, pref);
      }
      loaded = true;
      notify();
    })
    .catch((err) => {
      console.error("Failed to load photo variant preferences", err);
      loaded = true; // don't keep retrying on a transient error
    });
  return loadPromise;
}

/** Drop all in-memory overrides and re-fetch from the backend. Used
 *  after a library hot-swap. */
export function reloadVariantOverrides(): Promise<void> {
  overrides.clear();
  lastJpegOverrides.clear();
  sessionOverrides.clear();
  loaded = false;
  loadPromise = null;
  return loadVariantOverrides();
}

export function getVariantOverride(path: string): VariantPref | null {
  return overrides.get(path) ?? null;
}

export function hasSessionVariantOverride(path: string): boolean {
  return sessionOverrides.has(path);
}

export function getLastJpegVariantOverride(path: string): VariantPref | null {
  return lastJpegOverrides.get(path) ?? null;
}

/** Update the in-memory map and persist asynchronously. */
export function setVariantOverride(
  path: string,
  pref: VariantPref
): void {
  if (pref.format === "jpg") {
    lastJpegOverrides.set(path, pref);
    sessionOverrides.delete(path);
  } else {
    sessionOverrides.add(path);
  }
  const existing = overrides.get(path);
  if (
    existing &&
    existing.format === pref.format &&
    existing.variant === pref.variant
  ) {
    return;
  }
  overrides.set(path, pref);
  notify();
  // RAW is only for inspecting/editing the current photo. Persisting it would
  // make navigation reopen the RAW instead of the last selected JPEG.
  if (pref.format === "raw") return;
  void invoke("set_photo_variant", {
    path,
    format: pref.format,
    variant: pref.variant,
  }).catch((err) =>
    console.error("Failed to persist photo variant", err)
  );
}

export function subscribeVariantOverrides(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn();
}

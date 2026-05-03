/**
 * Cross-component cache + persistence for the user's per-photo
 * (format, variant) choice. The detail panel and the full view both
 * read/write this store so a selection made in one view shows up in
 * the other, and survives across launches via the SQLite-backed
 * `photo_variants` table.
 */
import { invoke } from "@tauri-apps/api/core";
import type { PhotoFormat } from "./photo-variant";

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
        overrides.set(r.path, { format: r.format, variant: r.variant });
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

export function getVariantOverride(path: string): VariantPref | null {
  return overrides.get(path) ?? null;
}

/** Update the in-memory map and persist asynchronously. */
export function setVariantOverride(
  path: string,
  pref: VariantPref
): void {
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

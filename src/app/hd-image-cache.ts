/**
 * Process-wide LRU cache for fully decoded `ImageBitmap`s of the HD
 * (1920px long-side) renditions shown in the full-screen viewer.
 *
 * Mirrors `full-image-cache.ts` — same lifecycle and dedupe — but pulls bytes from the backend's HD pipeline
 * (`get_hd_image_bytes`) instead of the full-resolution one. The HD
 * JPEG is what the canvas actually displays today; full-resolution
 * decoding is left in place for a future zoom-to-100 % path.
 *
 * Cache size follows `full_image_bitmap_max_entries`, with a floor of two
 * lightweight HD bitmaps for recently viewed photos.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { CacheSettings } from "./cache-settings";
import {
  beginTask,
  cancelTaskRequest,
  isTaskCancellation,
  nextRequestId,
} from "./task-manager";

// Keep a couple of lightweight HD bitmaps independently from expensive
// full-resolution bitmaps.
const MIN_HD_ENTRIES = 2;
const DEFAULT_MAX_ENTRIES = MIN_HD_ENTRIES;

const cache = new Map<string, ImageBitmap>();

interface PendingEntry {
  promise: Promise<ImageBitmap>;
  requestId: number;
  refcount: number;
  cancelled: boolean;
  cancel(): void;
}

const pending = new Map<string, PendingEntry>();
let maxEntries = DEFAULT_MAX_ENTRIES;

let decodeBytes: ((buf: ArrayBuffer) => Promise<ImageBitmap>) | null = null;

function setMaxEntries(n: number): void {
  if (!Number.isFinite(n) || n < 1) return;
  maxEntries = Math.max(MIN_HD_ENTRIES, Math.floor(n));
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    const oldest = cache.get(oldestKey);
    cache.delete(oldestKey);
    oldest?.close?.();
  }
}

let configured = false;
export async function configureHdImageCacheFromSettings(): Promise<void> {
  if (configured) return;
  configured = true;
  try {
    const s = await invoke<CacheSettings>("get_cache_settings");
    setMaxEntries(s.full_image_bitmap_max_entries);
  } catch (err) {
    console.warn("failed to load cache settings; using default", err);
  }
  void listen<CacheSettings>("cache-settings-changed", (event) => {
    setMaxEntries(event.payload.full_image_bitmap_max_entries);
  });
  void listen<string>("cache-cleared", (event) => {
    if (event.payload === "hd_image_disk") {
      clearHdImageCache();
    }
  });
}

export function setHdImageDecoder(
  decoder: (buf: ArrayBuffer) => Promise<ImageBitmap>
): void {
  decodeBytes = decoder;
}

export function getHdImage(path: string): ImageBitmap | null {
  const bm = cache.get(path);
  if (!bm) return null;
  cache.delete(path);
  cache.set(path, bm);
  return bm;
}

export interface LoadOptions {
  signal?: AbortSignal;
}

export function loadHdImage(
  path: string,
  options: LoadOptions = {}
): Promise<ImageBitmap> {
  const signal = options.signal;

  if (signal?.aborted) {
    return Promise.reject(new DOMException("aborted", "AbortError"));
  }

  // The HD preview represents the current photo. Once another path is
  // requested, no caller should keep older HD work alive.
  for (const [pendingPath, entry] of [...pending]) {
    if (pendingPath !== path) entry.cancel();
  }

  const cached = getHdImage(path);
  if (cached) return Promise.resolve(cached);

  let entry = pending.get(path);
  if (entry) {
    entry.refcount += 1;
  } else {
    entry = startLoad(path);
  }

  const captured = entry;
  return new Promise<ImageBitmap>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      releaseRef(captured);
      reject(new DOMException("aborted", "AbortError"));
    };
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
    captured.promise.then(
      (bm) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        resolve(bm);
      },
      (err) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        reject(err);
      }
    );
  });
}

function startLoad(path: string): PendingEntry {
  const decode = decodeBytes;
  if (!decode) {
    throw new Error("hd-image decoder not configured");
  }

  const requestId = nextRequestId();
  const task = beginTask({
    kind: "hd-image",
    label: "Opening HD image",
    priority: "urgent",
    target: path,
  });
  let rejectCancellation!: (reason: DOMException) => void;
  const entry: PendingEntry = {
    promise: undefined as unknown as Promise<ImageBitmap>,
    requestId,
    refcount: 1,
    cancelled: false,
    cancel(): void {},
  };

  const cancellation = new Promise<never>((_, reject) => {
    rejectCancellation = reject;
  });
  entry.cancel = (): void => {
    if (entry.cancelled) return;
    entry.cancelled = true;
    cancelTaskRequest(requestId);
    task.finish("cancelled");
    if (pending.get(path) === entry) pending.delete(path);
    rejectCancellation(new DOMException("aborted", "AbortError"));
  };

  const backend = (async (): Promise<ImageBitmap> => {
    const buf = await invoke<ArrayBuffer>("get_hd_image_bytes", {
      photoPath: path,
      requestId,
    });
    if (entry.cancelled) throw new DOMException("aborted", "AbortError");
    const bm = await decode(buf);
    if (entry.cancelled) {
      bm.close?.();
      throw new DOMException("aborted", "AbortError");
    }
    store(path, bm);
    return bm;
  })();
  entry.promise = Promise.race([backend, cancellation])
    .catch((error) => {
      task.finish(isTaskCancellation(error) ? "cancelled" : "failed");
      throw error;
    })
    .finally(() => {
      task.finish();
      if (pending.get(path) === entry) {
        pending.delete(path);
      }
    });
  pending.set(path, entry);
  return entry;
}

function releaseRef(entry: PendingEntry): void {
  if (entry.cancelled) return;
  entry.refcount -= 1;
  if (entry.refcount > 0) return;
  entry.cancel();
}

function store(path: string, bm: ImageBitmap): void {
  if (cache.has(path)) cache.delete(path);
  cache.set(path, bm);
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    const oldest = cache.get(oldestKey);
    cache.delete(oldestKey);
    oldest?.close?.();
  }
}

export function clearHdImageCache(): void {
  for (const entry of [...pending.values()]) entry.cancel();
  for (const bm of cache.values()) bm.close?.();
  cache.clear();
}

export function invalidateHdImages(paths: readonly string[]): void {
  for (const path of paths) {
    pending.get(path)?.cancel();
    cache.get(path)?.close?.();
    cache.delete(path);
  }
}

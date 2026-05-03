/**
 * Process-wide LRU cache for fully decoded `ImageBitmap`s of the HD
 * (1920px long-side) renditions shown in the full-screen viewer.
 *
 * Mirrors `full-image-cache.ts` exactly — same lifecycle, dedupe, and
 * priority semantics — but pulls bytes from the backend's HD pipeline
 * (`get_hd_image_bytes`) instead of the full-resolution one. The HD
 * JPEG is what the canvas actually displays today; full-resolution
 * decoding is left in place for a future zoom-to-100 % path.
 *
 * Cache size is wired to the same `full_image_bitmap_max_entries`
 * setting used by the full-image cache — the bitmap LRU bound is
 * driven by GPU memory, which is independent of which encoder
 * produced the bytes.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  cancelTaskRequest,
  nextRequestId,
  type TaskPriority,
} from "./task-manager";

const DEFAULT_MAX_ENTRIES = 4;

const cache = new Map<string, ImageBitmap>();

interface PendingEntry {
  promise: Promise<ImageBitmap>;
  priority: TaskPriority;
  requestId: number;
  refcount: number;
}

const pending = new Map<string, PendingEntry>();
let maxEntries = DEFAULT_MAX_ENTRIES;

const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 0,
  foreground: 1,
  background: 2,
};

let decodeBytes: ((buf: ArrayBuffer) => Promise<ImageBitmap>) | null = null;

interface CacheSettings {
  thumbnail_disk_max_entries: number;
  hd_image_disk_max_entries: number;
  full_image_memory_max_entries: number;
  full_image_bitmap_max_entries: number;
}

function setMaxEntries(n: number): void {
  if (!Number.isFinite(n) || n < 1) return;
  maxEntries = Math.floor(n);
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

export function hasHdImage(path: string): boolean {
  return cache.has(path);
}

export interface LoadOptions {
  priority?: TaskPriority;
  signal?: AbortSignal;
}

export function loadHdImage(
  path: string,
  options: LoadOptions = {}
): Promise<ImageBitmap> {
  const priority = options.priority ?? "urgent";
  const signal = options.signal;

  if (signal?.aborted) {
    return Promise.reject(new DOMException("aborted", "AbortError"));
  }

  const cached = getHdImage(path);
  if (cached) return Promise.resolve(cached);

  let entry = pending.get(path);
  if (
    entry &&
    PRIORITY_RANK[entry.priority] <= PRIORITY_RANK[priority]
  ) {
    entry.refcount += 1;
  } else {
    entry = startLoad(path, priority);
  }

  const captured = entry;
  return new Promise<ImageBitmap>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      releaseRef(path, captured);
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

function startLoad(path: string, priority: TaskPriority): PendingEntry {
  const decode = decodeBytes;
  if (!decode) {
    throw new Error("hd-image decoder not configured");
  }

  const requestId = nextRequestId();
  const entry: PendingEntry = {
    promise: undefined as unknown as Promise<ImageBitmap>,
    priority,
    requestId,
    refcount: 1,
  };

  entry.promise = (async (): Promise<ImageBitmap> => {
    try {
      const buf = await invoke<ArrayBuffer>("get_hd_image_bytes", {
        photoPath: path,
        requestId,
        priority,
      });
      const bm = await decode(buf);
      store(path, bm);
      return bm;
    } finally {
      if (pending.get(path) === entry) {
        pending.delete(path);
      }
    }
  })();
  pending.set(path, entry);
  return entry;
}

function releaseRef(path: string, entry: PendingEntry): void {
  entry.refcount -= 1;
  if (entry.refcount > 0) return;
  cancelTaskRequest(entry.requestId);
  if (pending.get(path) === entry) {
    pending.delete(path);
  }
}

export function prefetchHdImages(paths: readonly string[]): void {
  const limit = Math.min(paths.length, maxEntries);
  for (let i = limit - 1; i >= 0; i--) {
    const p = paths[i];
    if (cache.has(p)) {
      const bm = cache.get(p)!;
      cache.delete(p);
      cache.set(p, bm);
      continue;
    }
    if (pending.has(p)) continue;
    void loadHdImage(p, { priority: "background" }).catch((err) => {
      console.warn("hd image prefetch failed", p, err);
    });
  }
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
  for (const bm of cache.values()) bm.close?.();
  cache.clear();
  pending.clear();
}

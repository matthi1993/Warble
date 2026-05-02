/**
 * Process-wide LRU cache for fully decoded `ImageBitmap`s shown in the
 * full-screen viewer.
 *
 * The cache owns the lifecycle of its bitmaps: callers receive a live
 * bitmap reference and must NOT call `close()` on it. When an entry is
 * evicted (LRU overflow) the cache closes the underlying bitmap so the
 * GPU/CPU memory it pinned is released.
 *
 * Concurrency:
 *   - `get(path)` returns a cached bitmap synchronously if present,
 *     otherwise null. It also marks the entry as most-recently-used.
 *   - `load(path)` resolves to a bitmap, fetching+decoding only if the
 *     entry is missing. Concurrent `load` calls for the same path share
 *     one in-flight decode (deduped via `pending`).
 *   - `prefetch(paths)` is a fire-and-forget that touches existing
 *     entries (so they're protected by recency) and kicks off background
 *     decodes for the missing ones, in priority order.
 *
 * Sizing:
 *   - `MAX_ENTRIES = 20`. A 24 MP RGBA bitmap pins ~96 MB, so 20 entries
 *     is roughly a 1.9 GB upper bound on a worst-case library. For
 *     typical 12 MP photos it's ~960 MB. If this turns out too heavy on
 *     low-RAM machines we can lower it (or switch to a byte-budget LRU).
 */

import { invoke } from "@tauri-apps/api/core";

const MAX_ENTRIES = 4;

/** Insertion order = LRU order. Most-recently-used at the tail. */
const cache = new Map<string, ImageBitmap>();
const pending = new Map<string, Promise<ImageBitmap>>();

let decodeBytes: ((buf: ArrayBuffer) => Promise<ImageBitmap>) | null = null;

/** Late-bound by `pf-image-canvas` so this module doesn't need its own
 * worker plumbing duplicated. */
export function setFullImageDecoder(
  decoder: (buf: ArrayBuffer) => Promise<ImageBitmap>
): void {
  decodeBytes = decoder;
}

export function getFullImage(path: string): ImageBitmap | null {
  const bm = cache.get(path);
  if (!bm) return null;
  // Touch — move to most-recently-used.
  cache.delete(path);
  cache.set(path, bm);
  return bm;
}

export function hasFullImage(path: string): boolean {
  return cache.has(path);
}

export async function loadFullImage(path: string): Promise<ImageBitmap> {
  const cached = getFullImage(path);
  if (cached) return cached;
  const inflight = pending.get(path);
  if (inflight) return inflight;

  const decode = decodeBytes;
  if (!decode) {
    throw new Error("full-image decoder not configured");
  }

  const p = (async (): Promise<ImageBitmap> => {
    try {
      const buf = await invoke<ArrayBuffer>("get_full_image_bytes", {
        photoPath: path,
      });
      const bm = await decode(buf);
      store(path, bm);
      return bm;
    } finally {
      pending.delete(path);
    }
  })();
  pending.set(path, p);
  return p;
}

/**
 * Ensure the given paths are (or will be) in cache, in priority order:
 * earlier entries are touched/loaded first and are protected from
 * eviction by being most-recently-used. `paths` should be ordered from
 * highest priority (current photo) to lowest (farthest neighbour the
 * caller cares about). Up to `MAX_ENTRIES` paths are honoured; extras
 * are ignored to avoid evicting work we just queued.
 */
export function prefetchFullImages(paths: readonly string[]): void {
  const limit = Math.min(paths.length, MAX_ENTRIES);
  // Walk lowest priority → highest, so the highest-priority path ends
  // up most-recently-used after the loop (LRU eviction will spare it).
  for (let i = limit - 1; i >= 0; i--) {
    const p = paths[i];
    if (cache.has(p)) {
      // Touch.
      const bm = cache.get(p)!;
      cache.delete(p);
      cache.set(p, bm);
      continue;
    }
    if (pending.has(p)) continue;
    // Fire-and-forget; surface decode errors to the console only.
    void loadFullImage(p).catch((err) => {
      console.warn("full image prefetch failed", p, err);
    });
  }
}

function store(path: string, bm: ImageBitmap): void {
  if (cache.has(path)) cache.delete(path);
  cache.set(path, bm);
  while (cache.size > MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    const oldest = cache.get(oldestKey);
    cache.delete(oldestKey);
    oldest?.close?.();
  }
}

/** For tests / hot reload. Closes every cached bitmap. */
export function clearFullImageCache(): void {
  for (const bm of cache.values()) bm.close?.();
  cache.clear();
  pending.clear();
}

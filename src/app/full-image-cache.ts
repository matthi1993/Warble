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
 *   - `maxEntries` is user-configurable from the macOS Cache menu and is
 *     synced at startup via `get_cache_settings`. A 24 MP RGBA bitmap
 *     pins ~96 MB of GPU/CPU memory, so the default of 4 entries is a
 *     conservative ~380 MB worst case.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** Fallback used until the persisted setting is loaded from the backend. */
const DEFAULT_MAX_ENTRIES = 4;

/** Insertion order = LRU order. Most-recently-used at the tail. */
const cache = new Map<string, ImageBitmap>();
const pending = new Map<string, Promise<ImageBitmap>>();
let maxEntries = DEFAULT_MAX_ENTRIES;

let decodeBytes: ((buf: ArrayBuffer) => Promise<ImageBitmap>) | null = null;

interface CacheSettings {
  thumbnail_disk_max_entries: number;
  full_image_memory_max_entries: number;
  full_image_bitmap_max_entries: number;
}

/** Apply a new cap and evict oldest entries down to it. */
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

/** Wire up the bitmap cache to the persisted Tauri setting. Idempotent —
 * the first caller resolves the initial size; subsequent calls are
 * no-ops. */
let configured = false;
export async function configureFullImageCacheFromSettings(): Promise<void> {
  if (configured) return;
  configured = true;
  try {
    const s = await invoke<CacheSettings>("get_cache_settings");
    setMaxEntries(s.full_image_bitmap_max_entries);
  } catch (err) {
    console.warn("failed to load cache settings; using default", err);
  }
  // React to menu-driven changes at runtime.
  void listen<CacheSettings>("cache-settings-changed", (event) => {
    setMaxEntries(event.payload.full_image_bitmap_max_entries);
  });
}

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
 * caller cares about). Up to `maxEntries` paths are honoured; extras
 * are ignored to avoid evicting work we just queued.
 */
export function prefetchFullImages(paths: readonly string[]): void {
  const limit = Math.min(paths.length, maxEntries);
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
  while (cache.size > maxEntries) {
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

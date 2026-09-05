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
 *   - `loadFullImage(path, priority)` resolves to a bitmap, fetching +
 *     decoding only if the entry is missing. Concurrent loads for the
 *     same path share one in-flight decode (deduped via `pending`),
 *     unless a higher-priority caller arrives — in that case a fresh
 *     `urgent` request is issued so the active photo isn't stuck
 *     behind a low-priority neighbour prefetch.
 *   - `prefetchFullImages(paths)` is a fire-and-forget that touches
 *     existing entries (so they're protected by recency) and kicks
 *     off background decodes for the missing ones, in priority order.
 *
 * Cancellation:
 *   The byte-fetch step is dispatched through the backend priority
 *   pool with a per-request id. When a caller no longer needs the
 *   result (typically because the user navigated to a different
 *   photo), it can pass an `AbortSignal` to `loadFullImage`; on abort
 *   we send a `cancel_image_request` so the backend pool drops the
 *   job before it runs (already-running jobs run to completion but
 *   their result is discarded).
 *
 * Sizing:
 *   - `maxEntries` is user-configurable from the macOS Cache menu and is
 *     synced at startup via `get_cache_settings`. A 24 MP RGBA bitmap
 *     pins ~96 MB of GPU/CPU memory, so the default of 4 entries is a
 *     conservative ~380 MB worst case.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  cancelTaskRequest,
  nextRequestId,
  type TaskPriority,
} from "./task-manager";

/** Fallback used until the persisted setting is loaded from the backend. */
const DEFAULT_MAX_ENTRIES = 1;

/** Insertion order = LRU order. Most-recently-used at the tail. */
const cache = new Map<string, ImageBitmap>();

interface PendingEntry {
  promise: Promise<ImageBitmap>;
  priority: TaskPriority;
  /** Backend request id, used to cancel the byte fetch if every
   * caller has aborted. */
  requestId: number;
  /** Number of live callers still interested in the result. When this
   * drops to 0 we cancel the backend task. */
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

export interface LoadOptions {
  /** Priority for this request. Defaults to `urgent` so the canvas's
   * own loads stay snappy without every call site having to spell it
   * out. Prefetch explicitly downgrades to `background`. */
  priority?: TaskPriority;
  /** When the signal aborts, the caller's promise rejects with
   * `AbortError`. If this was the last live caller for the path, the
   * backend job is also cancelled. */
  signal?: AbortSignal;
}

export function loadFullImage(
  path: string,
  options: LoadOptions = {}
): Promise<ImageBitmap> {
  const priority = options.priority ?? "urgent";
  const signal = options.signal;

  if (signal?.aborted) {
    return Promise.reject(new DOMException("aborted", "AbortError"));
  }

  const cached = getFullImage(path);
  if (cached) return Promise.resolve(cached);

  let entry = pending.get(path);
  if (
    entry &&
    PRIORITY_RANK[entry.priority] <= PRIORITY_RANK[priority]
  ) {
    entry.refcount += 1;
  } else {
    // Either no in-flight load, or one at a strictly lower priority.
    // Issue a fresh request at the higher priority. The lower-priority
    // job keeps running but its result will be replaced by ours when
    // both land (last writer wins, both are functionally identical).
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
    throw new Error("full-image decoder not configured");
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
      const buf = await invoke<ArrayBuffer>("get_full_image_bytes", {
        photoPath: path,
        requestId,
        priority,
      });
      const bm = await decode(buf);
      store(path, bm);
      return bm;
    } finally {
      // Only clear our slot if it's still us — a higher-priority load
      // may have replaced this entry while we were running.
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
  // No live callers; cancel the backend job if it's still ours.
  cancelTaskRequest(entry.requestId);
  if (pending.get(path) === entry) {
    pending.delete(path);
  }
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
    // Fire-and-forget background decode. The neighbour prefetch must
    // never block the active photo, so it lands on the background
    // pool. We don't ref-count this because there's no caller to
    // cancel — the result either lands in the LRU (and will be picked
    // up by `getFullImage`) or fails harmlessly.
    void loadFullImage(p, { priority: "background" }).catch((err) => {
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

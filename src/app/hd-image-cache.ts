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
  background_pool_workers: number;
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
      // The backend writes the JPEG to its on-disk cache before
      // returning the bytes, so by the time we hold the decoded
      // bitmap the path is also guaranteed to be in the disk cache.
      markHdCached(path);
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

/**
 * Set of paths whose HD bytes have already been prewarmed (or are
 * being prewarmed) in the *backend disk cache*. Used to dedupe across
 * multiple `prewarmHdImageBytesForFolder` calls so we never re-issue
 * a background job for an image we've already touched.
 *
 * Note: this is independent of the in-memory `cache`/`pending` maps,
 * which track decoded `ImageBitmap`s. Prewarm only ensures the
 * encoded HD JPEG is on disk — it does not pin a bitmap.
 */
const prewarmedDisk = new Set<string>();

/**
 * Paths we've confirmed are present in the HD on-disk cache during
 * this session — populated after a successful `get_hd_image_bytes`
 * (whether triggered by the user or the folder prewarm). The grid
 * thumbnail card listens to `onHdCached` and badges its tile when
 * its path lands in this set.
 *
 * Note: this is best-effort; an entry written to disk in a previous
 * session won't be counted until something causes a load that hits
 * the cache. Good enough for the visual tick — the worst case is a
 * tick that lights up after a brief delay on first folder open.
 */
const hdCachedPaths = new Set<string>();
const hdCachedTarget = new EventTarget();

/** True when `path` has been confirmed present in the HD disk cache
 *  during this session. */
export function isHdCached(path: string): boolean {
  return hdCachedPaths.has(path);
}

/** Subscribe to per-path "this photo is now in the HD disk cache"
 *  events. Returns an unsubscribe function. */
export function onHdCached(listener: (path: string) => void): () => void {
  const handler = (e: Event) => {
    listener((e as CustomEvent<string>).detail);
  };
  hdCachedTarget.addEventListener("hd-cached", handler);
  return () => hdCachedTarget.removeEventListener("hd-cached", handler);
}

function markHdCached(path: string): void {
  if (hdCachedPaths.has(path)) return;
  hdCachedPaths.add(path);
  hdCachedTarget.dispatchEvent(
    new CustomEvent<string>("hd-cached", { detail: path })
  );
}

// ---------------------------------------------------------------------------
// HD prewarm progress tracking — mirrors `ThumbnailBatchProgress` so the
// shell footer can render a second progress bar for the folder-wide
// HD-disk-cache prewarm step that runs after thumbnails.
// ---------------------------------------------------------------------------

export interface HdPrewarmProgress {
  /** Monotonic id of the active prewarm batch. 0 means "no active batch". */
  batchId: number;
  total: number;
  loaded: number;
  failed: number;
  /** True while there is still work outstanding for the current batch. */
  inProgress: boolean;
}

const hdProgressTarget = new EventTarget();
let hdProgressState: HdPrewarmProgress = {
  batchId: 0,
  total: 0,
  loaded: 0,
  failed: 0,
  inProgress: false,
};
let nextHdBatchId = 1;

function emitHdProgress(): void {
  hdProgressTarget.dispatchEvent(
    new CustomEvent<HdPrewarmProgress>("progress", {
      detail: { ...hdProgressState },
    })
  );
}

export function getHdPrewarmProgress(): HdPrewarmProgress {
  return { ...hdProgressState };
}

export function onHdPrewarmProgress(
  listener: (state: HdPrewarmProgress) => void
): () => void {
  const handler = (e: Event) => {
    listener((e as CustomEvent<HdPrewarmProgress>).detail);
  };
  hdProgressTarget.addEventListener("progress", handler);
  return () => hdProgressTarget.removeEventListener("progress", handler);
}

interface PrewarmHandle {
  /** Cancel any not-yet-issued prewarm jobs for this batch. In-flight
   *  backend tasks are also cancelled via their request id. */
  cancel(): void;
}

/**
 * Warm the *backend* HD disk cache for every entry in `paths`. For
 * each path we:
 *
 * 1. Skip (counting as already-loaded) when an `ImageBitmap` is
 *    already in memory or the path is in `hdCachedPaths`.
 * 2. Skip (counting as already-loaded) when a previous prewarm
 *    already issued the request and we're still waiting on it.
 * 3. Otherwise invoke `get_hd_image_bytes` at `background` priority
 *    so it runs strictly behind any user-driven HD/full-image
 *    requests, and discard the returned bytes. The backend writes
 *    the JPEG to its on-disk cache as a side effect.
 *
 * Returns a handle the caller can use to abort the batch (e.g. on
 * folder change). Backend cancellation is wired through the existing
 * `cancelTaskRequest` plumbing.
 *
 * Each batch publishes progress via `onHdPrewarmProgress` so the
 * shell footer can render a progress bar identical to the one used
 * for thumbnails.
 */
export function prewarmHdImageBytesForFolder(
  paths: readonly string[]
): PrewarmHandle {
  let cancelled = false;
  const issuedRequestIds: number[] = [];
  const batchId = nextHdBatchId++;

  // Decide up-front which paths actually need a backend round-trip;
  // the remainder count toward `loaded` immediately so the progress
  // bar starts in a representative state instead of jumping from 0.
  const toFetch: string[] = [];
  let presumedLoaded = 0;
  for (const path of paths) {
    if (cache.has(path) || hdCachedPaths.has(path)) {
      presumedLoaded += 1;
      continue;
    }
    if (prewarmedDisk.has(path)) {
      // Already issued (perhaps still pending). Count as in-progress
      // for now; whichever issuer eventually marks it cached will
      // benefit our display via the `hd-cached` listener anyway.
      presumedLoaded += 1;
      continue;
    }
    toFetch.push(path);
  }

  hdProgressState = {
    batchId,
    total: paths.length,
    loaded: presumedLoaded,
    failed: 0,
    inProgress: paths.length > 0,
  };
  emitHdProgress();
  finalizeHdIfDone(batchId);

  const finalize = () => {
    if (hdProgressState.batchId !== batchId) return;
    finalizeHdIfDone(batchId);
    emitHdProgress();
  };

  for (const path of toFetch) {
    if (cancelled) break;
    prewarmedDisk.add(path);
    const requestId = nextRequestId();
    issuedRequestIds.push(requestId);
    void invoke<ArrayBuffer>("get_hd_image_bytes", {
      photoPath: path,
      requestId,
      priority: "background",
    })
      .then(() => {
        if (cancelled) return;
        markHdCached(path);
        if (hdProgressState.batchId !== batchId) return;
        hdProgressState = {
          ...hdProgressState,
          loaded: hdProgressState.loaded + 1,
        };
        finalize();
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = String((err as { message?: string })?.message ?? err);
        if (msg.includes("cancelled")) return;
        prewarmedDisk.delete(path);
        console.warn("hd image prewarm failed", path, err);
        if (hdProgressState.batchId !== batchId) return;
        hdProgressState = {
          ...hdProgressState,
          failed: hdProgressState.failed + 1,
        };
        finalize();
      });
  }

  return {
    cancel(): void {
      if (cancelled) return;
      cancelled = true;
      for (const id of issuedRequestIds) {
        cancelTaskRequest(id);
      }
      // Forget which paths were in flight: a future prewarm should
      // re-issue them instead of treating them as "already handled"
      // and skipping over them silently. (`hdCachedPaths` keeps any
      // that actually completed before cancel landed.)
      for (const path of toFetch) {
        prewarmedDisk.delete(path);
      }
      if (hdProgressState.batchId === batchId) {
        hdProgressState = { ...hdProgressState, inProgress: false };
        emitHdProgress();
      }
    },
  };
}

function finalizeHdIfDone(batchId: number): void {
  if (hdProgressState.batchId !== batchId) return;
  const done = hdProgressState.loaded + hdProgressState.failed;
  if (done >= hdProgressState.total) {
    hdProgressState = { ...hdProgressState, inProgress: false };
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
  prewarmedDisk.clear();
  hdCachedPaths.clear();
}

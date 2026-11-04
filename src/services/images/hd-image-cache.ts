/**
 * Process-wide LRU cache for fully decoded `ImageBitmap`s of the HD
 * (1920px long-side) renditions shown in the full-screen viewer.
 *
 * Mirrors `full-image-cache.ts` — same lifecycle and dedupe — but pulls bytes from the backend's HD pipeline
 * (`get_hd_image_bytes`) instead of the full-resolution one. The HD
 * JPEG provides a quick preview before the full-resolution image loads.
 *
 * Cache size includes room for the next few photos and recently viewed ones.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { CacheSettings } from "@services/settings/cache-settings";
import {
  beginTask,
  cancelTaskRequest,
  isTaskCancellation,
  nextRequestId,
  setTaskRequestPriority,
  type TaskHandle,
  type TaskPriority,
} from "@services/tasks/task-manager";

export const HD_PRELOAD_COUNT = 3;
const MIN_HD_ENTRIES = HD_PRELOAD_COUNT + 2;
const DEFAULT_MAX_ENTRIES = MIN_HD_ENTRIES;

const cache = new Map<string, ImageBitmap>();
const retained = new Map<string, number>();
const priorityRank: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, background: 3 };

interface PendingEntry {
  promise: Promise<ImageBitmap>;
  requestId: number;
  consumers: Map<symbol, TaskPriority>;
  priority: TaskPriority;
  task: TaskHandle;
  cancelled: boolean;
  cancel(): void;
}

const pending = new Map<string, PendingEntry>();
let maxEntries = DEFAULT_MAX_ENTRIES;

let decodeBytes: ((buf: ArrayBuffer) => Promise<ImageBitmap>) | null = null;

function setMaxEntries(n: number): void {
  if (!Number.isFinite(n) || n < 1) return;
  maxEntries = Math.max(MIN_HD_ENTRIES, Math.floor(n));
  evictOldImages();
}

function evictOldImages(): void {
  while (cache.size > maxEntries) {
    const oldestKey = [...cache.keys()].find((path) => !retained.has(path));
    if (oldestKey === undefined) break;
    cache.get(oldestKey)?.close?.();
    cache.delete(oldestKey);
  }
}

export function retainHdImage(path: string): () => void {
  retained.set(path, (retained.get(path) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (retained.get(path) ?? 1) - 1;
    if (remaining > 0) retained.set(path, remaining);
    else retained.delete(path);
    evictOldImages();
  };
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
  priority?: TaskPriority;
}

export function loadHdImage(
  path: string,
  options: LoadOptions = {}
): Promise<ImageBitmap> {
  const signal = options.signal;
  const priority = options.priority ?? "urgent";

  if (signal?.aborted) {
    return Promise.reject(new DOMException("aborted", "AbortError"));
  }

  const cached = getHdImage(path);
  if (cached) return Promise.resolve(cached);

  let entry = pending.get(path);
  if (!entry) entry = startLoad(path, priority);

  const captured = entry;
  const consumer = Symbol();
  captured.consumers.set(consumer, priority);
  updatePriority(captured);
  return new Promise<ImageBitmap>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      releaseRef(captured, consumer);
      reject(new DOMException("aborted", "AbortError"));
    };
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
    captured.promise.then(
      (bm) => {
        if (settled) return;
        settled = true;
        captured.consumers.delete(consumer);
        signal?.removeEventListener("abort", onAbort);
        resolve(bm);
      },
      (err) => {
        if (settled) return;
        settled = true;
        captured.consumers.delete(consumer);
        signal?.removeEventListener("abort", onAbort);
        reject(err);
      }
    );
  });
}

function updatePriority(entry: PendingEntry): void {
  const next = [...entry.consumers.values()].sort((a, b) => priorityRank[a] - priorityRank[b])[0];
  if (!next || next === entry.priority || entry.cancelled) return;
  entry.priority = next;
  entry.task.update({ priority: next, label: next === "background" ? "Preloading HD preview" : "Opening HD image" });
  setTaskRequestPriority(entry.requestId, next);
}

function startLoad(path: string, priority: TaskPriority): PendingEntry {
  const decode = decodeBytes;
  if (!decode) {
    throw new Error("hd-image decoder not configured");
  }

  const requestId = nextRequestId();
  const task = beginTask({
    kind: "hd-image",
    label: priority === "background" ? "Preloading HD preview" : "Opening HD image",
    priority,
    target: path,
  });
  let rejectCancellation!: (reason: DOMException) => void;
  const entry: PendingEntry = {
    promise: undefined as unknown as Promise<ImageBitmap>,
    requestId,
    consumers: new Map(),
    priority,
    task,
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
      priority,
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

function releaseRef(entry: PendingEntry, consumer: symbol): void {
  if (entry.cancelled) return;
  entry.consumers.delete(consumer);
  if (entry.consumers.size === 0) entry.cancel();
  else updatePriority(entry);
}

function store(path: string, bm: ImageBitmap): void {
  if (cache.has(path)) cache.delete(path);
  cache.set(path, bm);
  evictOldImages();
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

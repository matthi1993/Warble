import { invoke } from "@tauri-apps/api/core";
import { isVideoPath } from "./video-source";
import {
  beginTask,
  cancelTaskRequest,
  isTaskCancellation,
  nextRequestId,
  setTaskRequestPriority,
  type TaskHandle,
  type TaskPriority,
} from "@services/tasks/task-manager";

const CACHE_LIMIT = 500;
const cache = new Map<string, ArrayBuffer>();
const priorityRank: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, background: 3 };

interface ThumbnailResource {
  cacheReferences: number;
  imageReferences: number;
  url: string | null;
}

const resources = new WeakMap<ArrayBuffer, ThumbnailResource>();

function resourceFor(bytes: ArrayBuffer): ThumbnailResource {
  let resource = resources.get(bytes);
  if (!resource) {
    resource = { cacheReferences: 0, imageReferences: 0, url: null };
    resources.set(bytes, resource);
  }
  return resource;
}

function releaseUrl(resource: ThumbnailResource): void {
  if (resource.cacheReferences === 0 && resource.imageReferences === 0 && resource.url) {
    URL.revokeObjectURL(resource.url);
    resource.url = null;
  }
}

function forget(path: string): void {
  const bytes = cache.get(path);
  if (!bytes) return;
  cache.delete(path);
  const resource = resourceFor(bytes);
  resource.cacheReferences--;
  releaseUrl(resource);
}

export function getCachedThumbnail(path: string): ArrayBuffer | null {
  const bytes = cache.get(path);
  if (!bytes) return null;
  remember(path, bytes);
  return bytes;
}

export interface ThumbnailImage {
  url: string;
  release(): void;
}

export function acquireThumbnailImage(bytes: ArrayBuffer): ThumbnailImage {
  const resource = resourceFor(bytes);
  resource.url ??= URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
  resource.imageReferences++;
  let released = false;
  return {
    url: resource.url,
    release(): void {
      if (released) return;
      released = true;
      resource.imageReferences--;
      releaseUrl(resource);
    },
  };
}

interface PendingThumbnail {
  promise: Promise<ArrayBuffer>;
  requestId: number;
  consumers: Map<symbol, TaskPriority>;
  priority: TaskPriority;
  task: TaskHandle;
}

const pending = new Map<string, PendingThumbnail>();

function remember(path: string, bytes: ArrayBuffer): void {
  if (cache.get(path) === bytes) cache.delete(path);
  else {
    forget(path);
    resourceFor(bytes).cacheReferences++;
  }
  cache.set(path, bytes);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    forget(oldest);
  }
}

export interface ThumbnailHandle {
  promise: Promise<ArrayBuffer>;
  setPriority(priority: TaskPriority): void;
  cancel(): void;
}

/**
 * Load one thumbnail on demand. The backend owns the bounded worker queue;
 * this layer only deduplicates requests and keeps a small renderer cache.
 */
export function requestThumbnail(
  path: string,
  urgent = false,
  requestedPriority?: TaskPriority
): ThumbnailHandle {
  const cached = getCachedThumbnail(path);
  if (cached !== null) {
    return { promise: Promise.resolve(cached), setPriority() {}, cancel() {} };
  }

  const priority = requestedPriority ?? (urgent ? "urgent" : "high");
  let entry = pending.get(path);
  if (!entry) {
    const requestId = nextRequestId();
    const task = beginTask({
      kind: "thumbnail",
      label: "Generating thumbnail",
      priority,
      target: path,
    });
    entry = {
      requestId,
      consumers: new Map(),
      priority,
      task,
      promise: invoke<ArrayBuffer>("get_thumbnail", {
        photoPath: path,
        requestId,
        priority,
      })
        .then((bytes) => {
          if (pending.get(path) === entry) remember(path, bytes);
          return bytes;
        })
        .catch((error) => {
          task.finish(isTaskCancellation(error) ? "cancelled" : "failed");
          throw error;
        })
        .finally(() => {
          task.finish();
          if (pending.get(path) === entry) pending.delete(path);
        }),
    };
    pending.set(path, entry);
  }

  const captured = entry;
  const consumer = Symbol();
  const updatePriority = (): void => {
    const priorities = [...captured.consumers.values()];
    const next = priorities.sort((a, b) => priorityRank[a] - priorityRank[b])[0];
    if (!next || next === captured.priority || pending.get(path) !== captured) return;
    captured.priority = next;
    captured.task.update({ priority: next });
    setTaskRequestPriority(captured.requestId, next);
  };
  captured.consumers.set(consumer, priority);
  updatePriority();
  let released = false;
  return {
    promise: captured.promise,
    setPriority(priority): void {
      if (released) return;
      captured.consumers.set(consumer, priority);
      updatePriority();
    },
    cancel(): void {
      if (released) return;
      released = true;
      captured.consumers.delete(consumer);
      if (pending.get(path) !== captured) return;
      if (captured.consumers.size === 0) {
        cancelTaskRequest(captured.requestId);
        pending.delete(path);
      } else updatePriority();
    },
  };
}

/**
 * Warm thumbnails for a folder one at a time. Visible cards reuse the same
 * in-flight entries and can raise their displayed priority, while sequential
 * background work avoids flooding the backend queue with a whole folder.
 */
export function prefetchThumbnails(paths: readonly string[]): () => void {
  let cancelled = false;
  let current: ThumbnailHandle | null = null;

  void (async () => {
    for (const path of paths) {
      if (cancelled) return;
      if (isVideoPath(path)) continue;
      if (cache.has(path)) continue;
      current = requestThumbnail(path, false, "normal");
      try {
        await current.promise;
      } catch (error) {
        if (!isCancellation(error)) {
          console.warn("Failed to prefetch thumbnail", path, error);
        }
      } finally {
        current = null;
      }
    }
  })();

  return () => {
    if (cancelled) return;
    cancelled = true;
    current?.cancel();
    current = null;
  };
}

export function isCancellation(error: unknown): boolean {
  return isTaskCancellation(error);
}

/** Drop renderer-resident bytes. Existing requests finish or are cancelled by their owners. */
export function dropAllThumbnailState(): void {
  for (const path of cache.keys()) forget(path);
}

export function invalidateThumbnails(paths: readonly string[]): void {
  for (const path of paths) {
    forget(path);
    const entry = pending.get(path);
    if (entry) {
      cancelTaskRequest(entry.requestId);
      pending.delete(path);
    }
  }
}

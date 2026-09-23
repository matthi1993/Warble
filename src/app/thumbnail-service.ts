import { invoke } from "@tauri-apps/api/core";
import {
  beginTask,
  cancelTaskRequest,
  isTaskCancellation,
  nextRequestId,
  promoteTaskRequest,
  type TaskHandle,
  type TaskPriority,
} from "./task-manager";

const CACHE_LIMIT = 500;
const cache = new Map<string, ArrayBuffer>();

interface PendingThumbnail {
  promise: Promise<ArrayBuffer>;
  requestId: number;
  consumers: number;
  priority: TaskPriority;
  task: TaskHandle;
}

const pending = new Map<string, PendingThumbnail>();

function remember(path: string, bytes: ArrayBuffer): void {
  if (cache.has(path)) cache.delete(path);
  cache.set(path, bytes);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export interface ThumbnailHandle {
  promise: Promise<ArrayBuffer>;
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
  const cached = cache.get(path);
  if (cached !== undefined) {
    remember(path, cached);
    return { promise: Promise.resolve(cached), cancel() {} };
  }

  let entry = pending.get(path);
  if (!entry) {
    const requestId = nextRequestId();
    const priority = requestedPriority ?? (urgent ? "urgent" : "normal");
    const task = beginTask({
      kind: "thumbnail",
      label: "Generating thumbnail",
      priority,
      target: path,
    });
    entry = {
      requestId,
      consumers: 0,
      priority,
      task,
      promise: invoke<ArrayBuffer>("get_thumbnail", {
        photoPath: path,
        requestId,
        urgent,
        background: priority === "background",
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
  } else {
    const priority = requestedPriority ?? (urgent ? "urgent" : "normal");
    const rank: Record<TaskPriority, number> = {
      urgent: 0,
      high: 1,
      normal: 2,
      background: 3,
    };
    if (rank[priority] < rank[entry.priority]) {
      entry.priority = priority;
      entry.task.update({ priority });
      promoteTaskRequest(entry.requestId, priority === "urgent");
    }
  }

  entry.consumers += 1;
  let released = false;
  return {
    promise: entry.promise,
    cancel(): void {
      if (released) return;
      released = true;
      entry!.consumers -= 1;
      if (entry!.consumers === 0) {
        cancelTaskRequest(entry!.requestId);
        if (pending.get(path) === entry) pending.delete(path);
      }
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
      if (cache.has(path)) continue;
      current = requestThumbnail(path, false, "background");
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
  cache.clear();
}

export function invalidateThumbnails(paths: readonly string[]): void {
  for (const path of paths) {
    cache.delete(path);
    const entry = pending.get(path);
    if (entry) {
      cancelTaskRequest(entry.requestId);
      pending.delete(path);
    }
  }
}

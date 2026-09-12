import { invoke } from "@tauri-apps/api/core";
import { cancelTaskRequest, nextRequestId } from "./task-manager";

const CACHE_LIMIT = 500;
const cache = new Map<string, ArrayBuffer>();

interface PendingThumbnail {
  promise: Promise<ArrayBuffer>;
  requestId: number;
  consumers: number;
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
export function requestThumbnail(path: string, urgent = false): ThumbnailHandle {
  const cached = cache.get(path);
  if (cached !== undefined) {
    remember(path, cached);
    return { promise: Promise.resolve(cached), cancel() {} };
  }

  let entry = pending.get(path);
  if (!entry) {
    const requestId = nextRequestId();
    entry = {
      requestId,
      consumers: 0,
      promise: invoke<ArrayBuffer>("get_thumbnail", {
        photoPath: path,
        requestId,
        urgent,
      })
        .then((bytes) => {
          remember(path, bytes);
          return bytes;
        })
        .finally(() => {
          if (pending.get(path) === entry) pending.delete(path);
        }),
    };
    pending.set(path, entry);
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

export function isCancellation(error: unknown): boolean {
  const message = String((error as { message?: string } | null)?.message ?? error);
  return message.toLowerCase().includes("cancelled");
}

/** Drop renderer-resident bytes. Existing requests finish or are cancelled by their owners. */
export function dropAllThumbnailState(): void {
  cache.clear();
}

import { invoke } from "@tauri-apps/api/core";

/**
 * Centralised thumbnail loader. Limits concurrent Rust invocations so that
 * opening a large folder of big images does not flood the backend with
 * `spawn_blocking` jobs (each decoding multi-MB files). Also caches results
 * so re-visiting a folder is instant.
 */

const MAX_CONCURRENT = Math.min(
  8,
  Math.max(4, navigator.hardwareConcurrency ?? 4)
);

const CACHE_LIMIT = 500;

type Job = {
  path: string;
  cancelled: boolean;
  resolve: (value: string) => void;
  reject: (err: unknown) => void;
};

const cache = new Map<string, string>(); // path -> base64
const inflight = new Map<string, Promise<string>>();
const queue: Job[] = [];
let active = 0;

function rememberInCache(path: string, b64: string) {
  if (cache.has(path)) cache.delete(path);
  cache.set(path, b64);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function pump() {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const job = queue.shift()!;
    if (job.cancelled) {
      job.reject(new DOMException("cancelled", "AbortError"));
      continue;
    }
    active += 1;
    invoke<string>("get_thumbnail", { photoPath: job.path })
      .then((b64) => {
        rememberInCache(job.path, b64);
        if (!job.cancelled) job.resolve(b64);
        else job.reject(new DOMException("cancelled", "AbortError"));
      })
      .catch((err) => job.reject(err))
      .finally(() => {
        active -= 1;
        inflight.delete(job.path);
        pump();
      });
  }
}

export interface ThumbnailHandle {
  promise: Promise<string>;
  cancel(): void;
}

export function requestThumbnail(path: string): ThumbnailHandle {
  const cached = cache.get(path);
  if (cached !== undefined) {
    // Refresh LRU position.
    rememberInCache(path, cached);
    return { promise: Promise.resolve(cached), cancel: () => {} };
  }

  const existing = inflight.get(path);
  if (existing) {
    return { promise: existing, cancel: () => {} };
  }

  let job!: Job;
  const promise = new Promise<string>((resolve, reject) => {
    job = { path, cancelled: false, resolve, reject };
    queue.push(job);
  });
  inflight.set(path, promise);
  pump();

  return {
    promise,
    cancel: () => {
      job.cancelled = true;
    },
  };
}

export function isCancellation(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

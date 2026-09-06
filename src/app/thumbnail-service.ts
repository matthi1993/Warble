import { invoke } from "@tauri-apps/api/core";
import {
  cancelTaskRequest,
  nextRequestId,
  type TaskPriority,
} from "./task-manager";
import { getCacheSettings } from "./cache-settings";

/**
 * Centralised thumbnail loader. Limits concurrent Rust invocations so that
 * opening a large folder of big images does not flood the backend with
 * `spawn_blocking` jobs (each decoding multi-MB files). Also caches results
 * so re-visiting a folder is instant.
 *
 * Requests are routed at one of three priority tiers:
 *
 *   - `urgent`     — the photo currently on screen.
 *   - `foreground` — visible thumbnail cards in the grid.
 *   - `background` — folder-wide batch prefetch.
 *
 * The renderer drains its three queues in priority order so an
 * urgent request issued while a 1000-image batch is mid-pump runs
 * before any further batch jobs leave the renderer. The backend
 * additionally splits work across two thread pools so background
 * decodes can never starve a foreground one.
 */

const TOUCH_DEVICE = (navigator.maxTouchPoints ?? 0) > 1;
const MAX_CONCURRENT = TOUCH_DEVICE
  ? 2
  : Math.min(8, Math.max(4, navigator.hardwareConcurrency ?? 4));

const CACHE_LIMIT = 500;

type Job = {
  path: string;
  priority: TaskPriority;
  requestId: number;
  cancelled: boolean;
  /** True once this job has actually been sent to the backend. Once
   * dispatched we can't pull it back out of the priority queue, so
   * cancellation has to go through the backend cancel command. */
  dispatched: boolean;
  resolve: (value: string) => void;
  reject: (err: unknown) => void;
};

const cache = new Map<string, string>(); // path -> base64
const inflight = new Map<
  string,
  { promise: Promise<string>; priority: TaskPriority }
>();

/** One queue per priority tier so a flood of background jobs can never
 * push a fresh urgent/foreground job to the back of the line. */
const queues: Record<TaskPriority, Job[]> = {
  urgent: [],
  foreground: [],
  background: [],
};
const PRIORITY_ORDER: TaskPriority[] = ["urgent", "foreground", "background"];
const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 0,
  foreground: 1,
  background: 2,
};
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

function nextJob(): Job | undefined {
  for (const p of PRIORITY_ORDER) {
    const q = queues[p];
    while (q.length > 0) {
      const job = q.shift()!;
      if (!job.cancelled) return job;
    }
  }
  return undefined;
}

function isBackendCancellation(err: unknown): boolean {
  if (err == null) return false;
  const s =
    typeof err === "string" ? err : (err as Error).message ?? String(err);
  return s.toLowerCase().includes("cancelled");
}

function pump() {
  while (active < MAX_CONCURRENT) {
    const job = nextJob();
    if (!job) return;
    active += 1;
    job.dispatched = true;
    invoke<string>("get_thumbnail", {
      photoPath: job.path,
      requestId: job.requestId,
      priority: job.priority,
    })
      .then((b64) => {
        rememberInCache(job.path, b64);
        if (!job.cancelled) job.resolve(b64);
        else job.reject(new DOMException("cancelled", "AbortError"));
      })
      .catch((err) => {
        if (job.cancelled || isBackendCancellation(err)) {
          job.reject(new DOMException("cancelled", "AbortError"));
        } else {
          job.reject(err);
        }
      })
      .finally(() => {
        active -= 1;
        const slot = inflight.get(job.path);
        // Only remove the inflight entry if it's still ours; a
        // priority-upgrade may have replaced it with a fresher one.
        if (slot && slot.priority === job.priority) {
          inflight.delete(job.path);
        }
        pump();
      });
  }
}

export interface ThumbnailHandle {
  promise: Promise<string>;
  cancel(): void;
}

export function requestThumbnail(
  path: string,
  priority: TaskPriority = "foreground"
): ThumbnailHandle {
  const cached = cache.get(path);
  if (cached !== undefined) {
    rememberInCache(path, cached);
    return { promise: Promise.resolve(cached), cancel: () => {} };
  }

  const existing = inflight.get(path);
  if (
    existing &&
    PRIORITY_RANK[existing.priority] <= PRIORITY_RANK[priority]
  ) {
    // Existing in-flight request is at same or higher priority; share it.
    return { promise: existing.promise, cancel: () => {} };
  }

  // Either no in-flight request, or it's at a *lower* priority. Issue a
  // fresh request so the urgent/foreground caller doesn't get stuck
  // behind a batch entry. Both will land via the disk cache.

  let job!: Job;
  const promise = new Promise<string>((resolve, reject) => {
    job = {
      path,
      priority,
      requestId: nextRequestId(),
      cancelled: false,
      dispatched: false,
      resolve,
      reject,
    };
    queues[priority].push(job);
  });
  inflight.set(path, { promise, priority });
  pump();

  return {
    promise,
    cancel: () => {
      if (job.cancelled) return;
      job.cancelled = true;
      if (job.dispatched) {
        // Already sent to the backend — ask the pool to drop it before
        // it actually runs.
        cancelTaskRequest(job.requestId);
      }
    },
  };
}

export function isCancellation(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

// ---------------------------------------------------------------------------
// Batch prefetching + progress
// ---------------------------------------------------------------------------

export interface ThumbnailBatchProgress {
  /** Monotonic id of the active batch. 0 means "no active batch". */
  batchId: number;
  total: number;
  loaded: number;
  failed: number;
  /** True while there is still work outstanding for the current batch. */
  inProgress: boolean;
}

const progressTarget = new EventTarget();
let progressState: ThumbnailBatchProgress = {
  batchId: 0,
  total: 0,
  loaded: 0,
  failed: 0,
  inProgress: false,
};

let nextBatchId = 1;
const BATCH_QUEUE_AHEAD = 64;

/** The current batch keeps only a small queue ahead of the visible cards.
 * This prevents opening a large folder from allocating thousands of promises
 * and background tasks before the first paint. */
let activeBatch: {
  id: number;
  paths: string[];
  nextPath: number;
  pending: number;
  handles: Set<ThumbnailHandle>;
} | null = null;

function emitProgress() {
  progressTarget.dispatchEvent(
    new CustomEvent<ThumbnailBatchProgress>("progress", {
      detail: { ...progressState },
    })
  );
}

export function getThumbnailProgress(): ThumbnailBatchProgress {
  return { ...progressState };
}

export function onThumbnailProgress(
  listener: (state: ThumbnailBatchProgress) => void
): () => void {
  const handler = (e: Event) => {
    listener((e as CustomEvent<ThumbnailBatchProgress>).detail);
  };
  progressTarget.addEventListener("progress", handler);
  return () => progressTarget.removeEventListener("progress", handler);
}

/**
 * Start prefetching thumbnails for `paths` in the order given. Replaces any
 * currently-active batch. Returns the new batch id. Subsequent UI requests
 * for the same paths will dedupe against the in-flight prefetch (so on-screen
 * cards render as soon as their thumbnail has been generated by the batch).
 */
export function startThumbnailBatch(paths: string[]): number {
  // Cancel any previous batch so its outstanding (queued, not yet running)
  // jobs stop tying up the worker pool.
  clearThumbnailBatch();

  if (!getCacheSettings().background_thumbnails_enabled) {
    return 0;
  }

  const batchId = nextBatchId++;
  progressState = {
    batchId,
    total: paths.length,
    loaded: 0,
    failed: 0,
    inProgress: paths.length > 0,
  };
  emitProgress();

  if (paths.length === 0) return batchId;

  activeBatch = {
    id: batchId,
    paths,
    nextPath: 0,
    pending: 0,
    handles: new Set(),
  };
  queueMoreBatchWork(activeBatch);
  return batchId;
}

function queueMoreBatchWork(batch: NonNullable<typeof activeBatch>): void {
  if (activeBatch !== batch || progressState.batchId !== batch.id) return;
  while (
    batch.pending < BATCH_QUEUE_AHEAD &&
    batch.nextPath < batch.paths.length
  ) {
    const path = batch.paths[batch.nextPath++];
    // Folder-wide prefetch is strictly background work — visible cards and
    // the active photo upgrade priority on their own.
    const handle = requestThumbnail(path, "background");
    batch.handles.add(handle);
    batch.pending += 1;
    handle.promise.then(
      () => {
        if (progressState.batchId !== batch.id) return;
        progressState = {
          ...progressState,
          loaded: progressState.loaded + 1,
        };
        finalizeIfDone(batch.id);
        emitProgress();
      },
      (err) => {
        if (progressState.batchId !== batch.id) return;
        if (isCancellation(err)) return;
        progressState = {
          ...progressState,
          failed: progressState.failed + 1,
        };
        finalizeIfDone(batch.id);
        emitProgress();
      }
    ).finally(() => {
      batch.handles.delete(handle);
      batch.pending -= 1;
      queueMoreBatchWork(batch);
    });
  }
}

function finalizeIfDone(batchId: number) {
  if (progressState.batchId !== batchId) return;
  const done = progressState.loaded + progressState.failed;
  if (done >= progressState.total) {
    progressState = { ...progressState, inProgress: false };
  }
}

/** Cancel the active batch (if any) and reset progress to idle. */
export function clearThumbnailBatch() {
  for (const h of activeBatch?.handles ?? []) h.cancel();
  activeBatch = null;
  progressState = {
    batchId: 0,
    total: 0,
    loaded: 0,
    failed: 0,
    inProgress: false,
  };
  emitProgress();
}

/**
 * Drop every cached/inflight thumbnail in the renderer process. Pending
 * jobs are cancelled so callers waiting on them get an `AbortError`.
 * After this returns, subsequent `requestThumbnail` calls will go all
 * the way back to the Rust backend (and, with the disk cache also
 * cleared, all the way back to source decoding).
 */
export function dropAllThumbnailState(): void {
  cache.clear();
  for (const p of PRIORITY_ORDER) {
    for (const job of queues[p]) job.cancelled = true;
    queues[p].length = 0;
  }
  inflight.clear();
  for (const h of activeBatch?.handles ?? []) h.cancel();
  activeBatch = null;
  progressState = {
    batchId: 0,
    total: 0,
    loaded: 0,
    failed: 0,
    inProgress: false,
  };
  emitProgress();
}

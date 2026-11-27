import { isCancellation, type TaskPriority, type TaskTracker } from "@warble/core";
import type { ImageBackend } from "../ports/image-backend";
import type { ImageRequests } from "../requests/image-requests";
import { PendingRequest } from "../requests/pending-request";
import { VideoSources } from "../video/video-sources";
import { ThumbnailCache, type ThumbnailImage } from "./thumbnail-cache";

export interface ThumbnailHandle {
  promise: Promise<ArrayBuffer>;
  setPriority(priority: TaskPriority): void;
  cancel(): void;
}

export class ThumbnailService {
  private readonly cache = new ThumbnailCache();
  private readonly pending = new Map<string, PendingRequest<ArrayBuffer>>();

  constructor(
    private readonly backend: ImageBackend,
    private readonly requests: ImageRequests,
    private readonly tasks: TaskTracker,
  ) {}

  cached(path: string): ArrayBuffer | null {
    return this.cache.get(path);
  }

  acquireImage(bytes: ArrayBuffer): ThumbnailImage {
    return this.cache.acquireImage(bytes);
  }

  request(path: string, priority: TaskPriority = "high"): ThumbnailHandle {
    const cached = this.cache.get(path);
    if (cached !== null) {
      return { promise: Promise.resolve(cached), setPriority() {}, cancel() {} };
    }

    const request = this.pending.get(path) ?? this.start(path, priority);
    const consumer = request.join(priority);
    this.applyConsumerPriority(path, request);
    let released = false;
    return {
      promise: request.result,
      setPriority: (next) => {
        if (released) return;
        request.setConsumerPriority(consumer, next);
        this.applyConsumerPriority(path, request);
      },
      cancel: () => {
        if (released) return;
        released = true;
        request.leave(consumer);
        if (this.pending.get(path) !== request) return;
        if (request.hasConsumers) {
          this.applyConsumerPriority(path, request);
        } else {
          this.requests.cancelRequest(request.id);
          this.pending.delete(path);
        }
      },
    };
  }

  prefetch(paths: readonly string[]): () => void {
    let stopped = false;
    let current: ThumbnailHandle | null = null;

    void (async () => {
      for (const path of paths) {
        if (stopped) return;
        if (VideoSources.isVideo(path) || this.cache.has(path)) continue;
        current = this.request(path, "normal");
        try {
          await current.promise;
        } catch (error) {
          if (!isCancellation(error)) console.warn("Failed to prefetch thumbnail", path, error);
        } finally {
          current = null;
        }
      }
    })();

    return () => {
      if (stopped) return;
      stopped = true;
      current?.cancel();
      current = null;
    };
  }

  clear(): void {
    this.cache.clear();
  }

  invalidate(paths: readonly string[]): void {
    for (const path of paths) {
      this.cache.delete(path);
      const request = this.pending.get(path);
      if (!request) continue;
      this.requests.cancelRequest(request.id);
      this.pending.delete(path);
    }
  }

  private start(path: string, priority: TaskPriority): PendingRequest<ArrayBuffer> {
    const id = this.requests.nextRequestId();
    const task = this.tasks.begin({ kind: "thumbnail", label: "Generating thumbnail", priority, target: path });
    const request = new PendingRequest<ArrayBuffer>(id, task, priority);
    request.result = this.backend
      .thumbnailBytes(path, id, priority)
      .then((bytes) => {
        if (this.pending.get(path) === request) this.cache.set(path, bytes);
        return bytes;
      })
      .catch((error) => {
        task.finish(isCancellation(error) ? "cancelled" : "failed");
        throw error;
      })
      .finally(() => {
        task.finish();
        if (this.pending.get(path) === request) this.pending.delete(path);
      });
    this.pending.set(path, request);
    return request;
  }

  private applyConsumerPriority(path: string, request: PendingRequest<ArrayBuffer>): void {
    if (this.pending.get(path) !== request || !request.adoptHighestConsumerPriority()) return;
    request.task.update({ priority: request.priority });
    this.requests.setRequestPriority(request.id, request.priority);
  }
}

import { LruCache, isCancellation, type TaskPriority, type TaskTracker, type Unsubscribe } from "@warble/core";
import type { ImageBackend } from "../ports/image-backend";
import type { ImageDecoder } from "../ports/image-decoder";
import type { ImageRequests } from "../requests/image-requests";
import { PendingRequest } from "../requests/pending-request";

export const HD_PRELOAD_COUNT = 3;
const MIN_ENTRIES = HD_PRELOAD_COUNT + 2;

export interface HdImageLoadOptions {
  signal?: AbortSignal;
  priority?: TaskPriority;
}

export class HdImageCache {
  private readonly retained = new Map<string, number>();
  private readonly pending = new Map<string, PendingRequest<ImageBitmap>>();
  private readonly bitmaps = new LruCache<string, ImageBitmap>({
    capacity: MIN_ENTRIES,
    onEvict: (bitmap) => bitmap.close?.(),
    isPinned: (path) => this.retained.has(path),
  });
  private readonly stopListening: Unsubscribe;

  constructor(
    private readonly backend: ImageBackend,
    private readonly requests: ImageRequests,
    private readonly tasks: TaskTracker,
    private readonly decoder: ImageDecoder,
  ) {
    this.stopListening = backend.onCacheCleared((cache) => {
      if (cache === "hd_image_disk") this.clear();
    });
  }

  setCapacity(entries: number): void {
    if (!Number.isFinite(entries) || entries < 1) return;
    this.bitmaps.resize(Math.max(MIN_ENTRIES, Math.floor(entries)));
  }

  get(path: string): ImageBitmap | null {
    return this.bitmaps.get(path) ?? null;
  }

  load(path: string, options: HdImageLoadOptions = {}): Promise<ImageBitmap> {
    const { signal, priority = "urgent" } = options;
    if (signal?.aborted) return Promise.reject(new DOMException("aborted", "AbortError"));

    const cached = this.get(path);
    if (cached) return Promise.resolve(cached);

    const request = this.pending.get(path) ?? this.start(path, priority);
    const consumer = request.join(priority);
    this.applyConsumerPriority(request);
    return request.resultUnlessAborted(signal, () => this.release(path, request, consumer));
  }

  retain(path: string): () => void {
    this.retained.set(path, (this.retained.get(path) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (this.retained.get(path) ?? 1) - 1;
      if (remaining > 0) this.retained.set(path, remaining);
      else this.retained.delete(path);
      // Resizing to the same capacity evicts the overflow that was pinned until now.
      this.bitmaps.resize(this.bitmaps.capacity);
    };
  }

  clear(): void {
    for (const [path, request] of [...this.pending]) this.cancel(path, request);
    this.bitmaps.clear();
  }

  invalidate(paths: readonly string[]): void {
    for (const path of paths) {
      const request = this.pending.get(path);
      if (request) this.cancel(path, request);
      this.bitmaps.delete(path);
    }
  }

  dispose(): void {
    this.stopListening();
  }

  private start(path: string, priority: TaskPriority): PendingRequest<ImageBitmap> {
    const id = this.requests.nextRequestId();
    const task = this.tasks.begin({ kind: "hd-image", label: this.labelFor(priority), priority, target: path });
    const request = new PendingRequest<ImageBitmap>(id, task, priority);
    request.result = Promise.race([this.fetchAndDecode(path, request), request.whenCancelled()])
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

  private async fetchAndDecode(path: string, request: PendingRequest<ImageBitmap>): Promise<ImageBitmap> {
    const bytes = await this.backend.hdImageBytes(path, request.id, request.priority);
    if (request.cancelled) throw new DOMException("aborted", "AbortError");
    const bitmap = await this.decoder.decode(bytes);
    if (request.cancelled) {
      bitmap.close?.();
      throw new DOMException("aborted", "AbortError");
    }
    this.bitmaps.set(path, bitmap);
    return bitmap;
  }

  private release(path: string, request: PendingRequest<ImageBitmap>, consumer: symbol): void {
    if (request.cancelled) return;
    request.leave(consumer);
    if (request.hasConsumers) this.applyConsumerPriority(request);
    else this.cancel(path, request);
  }

  private cancel(path: string, request: PendingRequest<ImageBitmap>): void {
    if (request.cancelled) return;
    request.cancel();
    this.requests.cancelRequest(request.id);
    request.task.finish("cancelled");
    if (this.pending.get(path) === request) this.pending.delete(path);
  }

  private applyConsumerPriority(request: PendingRequest<ImageBitmap>): void {
    if (request.cancelled || !request.adoptHighestConsumerPriority()) return;
    request.task.update({ priority: request.priority, label: this.labelFor(request.priority) });
    this.requests.setRequestPriority(request.id, request.priority);
  }

  private labelFor(priority: TaskPriority): string {
    return priority === "background" ? "Preloading HD preview" : "Opening HD image";
  }
}

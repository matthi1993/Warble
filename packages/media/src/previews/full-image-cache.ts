import { LruCache, isCancellation, type TaskTracker } from "@warble/core";
import type { ImageBackend } from "../ports/image-backend";
import type { ImageDecoder } from "../ports/image-decoder";
import type { ImageRequests } from "../requests/image-requests";
import { PendingRequest } from "../requests/pending-request";

export interface FullImageLoadOptions {
  signal?: AbortSignal;
}

export class FullImageCache {
  private readonly pending = new Map<string, PendingRequest<ImageBitmap>>();
  private readonly bitmaps = new LruCache<string, ImageBitmap>({
    capacity: 1,
    onEvict: (bitmap) => bitmap.close?.(),
  });

  constructor(
    private readonly backend: ImageBackend,
    private readonly requests: ImageRequests,
    private readonly tasks: TaskTracker,
    private readonly decoder: ImageDecoder,
  ) {}

  setCapacity(entries: number): void {
    if (!Number.isFinite(entries) || entries < 1) return;
    this.bitmaps.resize(Math.floor(entries));
  }

  get(path: string): ImageBitmap | null {
    return this.bitmaps.get(path) ?? null;
  }

  load(path: string, options: FullImageLoadOptions = {}): Promise<ImageBitmap> {
    const { signal } = options;
    if (signal?.aborted) return Promise.reject(new DOMException("aborted", "AbortError"));

    const cached = this.get(path);
    if (cached) return Promise.resolve(cached);

    const request = this.pending.get(path) ?? this.start(path);
    const consumer = request.join("urgent");
    return request.resultUnlessAborted(signal, () => this.release(path, request, consumer));
  }

  invalidate(paths: readonly string[]): void {
    for (const path of paths) {
      const request = this.pending.get(path);
      if (request) this.abandon(path, request);
      this.bitmaps.delete(path);
    }
  }

  private start(path: string): PendingRequest<ImageBitmap> {
    const id = this.requests.nextRequestId();
    const task = this.tasks.begin({ kind: "full-image", label: "Opening full image", priority: "urgent", target: path });
    const request = new PendingRequest<ImageBitmap>(id, task, "urgent");
    request.result = this.fetchAndDecode(path, request);
    this.pending.set(path, request);
    return request;
  }

  private async fetchAndDecode(path: string, request: PendingRequest<ImageBitmap>): Promise<ImageBitmap> {
    try {
      const bytes = await this.backend.fullImageBytes(path, request.id);
      const bitmap = await this.decoder.decode(bytes);
      if (request.cancelled) {
        bitmap.close?.();
        throw new DOMException("aborted", "AbortError");
      }
      this.bitmaps.set(path, bitmap);
      return bitmap;
    } catch (error) {
      request.task.finish(isCancellation(error) ? "cancelled" : "failed");
      throw error;
    } finally {
      request.task.finish();
      if (this.pending.get(path) === request) this.pending.delete(path);
    }
  }

  private release(path: string, request: PendingRequest<ImageBitmap>, consumer: symbol): void {
    request.leave(consumer);
    if (!request.hasConsumers) this.abandon(path, request);
  }

  // A fetch already running on the backend still completes; its bitmap is closed after decoding.
  private abandon(path: string, request: PendingRequest<ImageBitmap>): void {
    request.cancel();
    this.requests.cancelRequest(request.id);
    if (this.pending.get(path) === request) this.pending.delete(path);
  }
}

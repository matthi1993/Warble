import { Emitter, type TaskPriority, type Unsubscribe } from "@warble/core";
import type { ClearedCache, ImageBackend, ImageDecoder } from "../../src";

export interface ImageFetch {
  path: string;
  requestId: number;
  priority?: TaskPriority;
  resolve(bytes: ArrayBuffer): void;
  reject(error: unknown): void;
}

export class FakeImageBackend implements ImageBackend {
  readonly fetches: ImageFetch[] = [];
  readonly cancelled: number[] = [];
  readonly priorities: Array<{ requestId: number; priority: TaskPriority }> = [];
  private readonly cacheCleared = new Emitter<ClearedCache>();

  thumbnailBytes(path: string, requestId: number, priority: TaskPriority): Promise<ArrayBuffer> {
    return this.fetch(path, requestId, priority);
  }

  hdImageBytes(path: string, requestId: number, priority: TaskPriority): Promise<ArrayBuffer> {
    return this.fetch(path, requestId, priority);
  }

  fullImageBytes(path: string, requestId: number): Promise<ArrayBuffer> {
    return this.fetch(path, requestId);
  }

  async cancelRequest(requestId: number): Promise<void> {
    this.cancelled.push(requestId);
  }

  async setRequestPriority(requestId: number, priority: TaskPriority): Promise<void> {
    this.priorities.push({ requestId, priority });
  }

  async videoSource(path: string): Promise<string> {
    return `asset://${path}`;
  }

  onCacheCleared(listener: (cache: ClearedCache) => void): Unsubscribe {
    return this.cacheCleared.subscribe(listener);
  }

  clearCache(cache: ClearedCache): void {
    this.cacheCleared.emit(cache);
  }

  private fetch(path: string, requestId: number, priority?: TaskPriority): Promise<ArrayBuffer> {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      this.fetches.push({ path, requestId, priority, resolve, reject });
    });
  }
}

export class FakeBitmap implements ImageBitmap {
  readonly width = 1920;
  readonly height = 1280;
  closed = false;

  close(): void {
    this.closed = true;
  }
}

export class FakeImageDecoder implements ImageDecoder {
  private readonly decoded = new Map<ArrayBuffer, ImageBitmap | Promise<ImageBitmap>>();

  encode(bitmap: ImageBitmap | Promise<ImageBitmap>): ArrayBuffer {
    const bytes = new ArrayBuffer(1);
    this.decoded.set(bytes, bitmap);
    return bytes;
  }

  async decode(bytes: ArrayBuffer): Promise<ImageBitmap> {
    const bitmap = this.decoded.get(bytes);
    if (!bitmap) throw new Error("unknown image bytes");
    return bitmap;
  }
}

export function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve));
}

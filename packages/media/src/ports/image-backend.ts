import type { TaskPriority, Unsubscribe } from "@warble/core";

export type ClearedCache = "thumbnail_disk" | "hd_image_disk" | "full_image_memory";

export interface ImageBackend {
  thumbnailBytes(path: string, requestId: number, priority: TaskPriority): Promise<ArrayBuffer>;
  hdImageBytes(path: string, requestId: number, priority: TaskPriority): Promise<ArrayBuffer>;
  fullImageBytes(path: string, requestId: number): Promise<ArrayBuffer>;
  cancelRequest(requestId: number): Promise<void>;
  setRequestPriority(requestId: number, priority: TaskPriority): Promise<void>;
  videoSource(path: string): Promise<string>;
  onCacheCleared(listener: (cache: ClearedCache) => void): Unsubscribe;
}

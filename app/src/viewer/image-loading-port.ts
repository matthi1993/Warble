export interface ThumbnailRequest {
  readonly promise: Promise<ImageBitmap>;
  cancel(): void;
}

/** Cached bitmaps stay owned by their cache. */
export interface ImageLoadingPort {
  loadThumbnail(path: string): ThumbnailRequest;
  isCancellation(error: unknown): boolean;
  cachedHd(path: string): ImageBitmap | null;
  loadHd(path: string, signal: AbortSignal): Promise<ImageBitmap>;
  cachedFull(path: string): ImageBitmap | null;
  loadFull(path: string, signal?: AbortSignal): Promise<ImageBitmap>;
}

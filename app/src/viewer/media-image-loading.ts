import { isCancellation } from "@warble/core";
import type { MediaServices } from "@app/composition/media-services";
import type { ImageLoadingPort, ThumbnailRequest } from "./image-loading-port";

export class MediaImageLoading implements ImageLoadingPort {
  constructor(private readonly media: MediaServices) {}

  loadThumbnail(path: string): ThumbnailRequest {
    const handle = this.media.thumbnails.request(path, "urgent");
    return {
      promise: handle.promise.then((bytes) => this.media.jpegDecoder.decode(bytes)),
      cancel: () => handle.cancel(),
    };
  }

  isCancellation(error: unknown): boolean {
    return isCancellation(error);
  }

  cachedHd(path: string): ImageBitmap | null {
    return this.media.hdImages.get(path);
  }

  loadHd(path: string, signal: AbortSignal): Promise<ImageBitmap> {
    return this.media.hdImages.load(path, { signal });
  }

  cachedFull(path: string): ImageBitmap | null {
    return this.media.fullImages.get(path);
  }

  loadFull(path: string, signal?: AbortSignal): Promise<ImageBitmap> {
    return this.media.fullImages.load(path, { signal });
  }
}

import type { ViewerSettings } from "./viewer-settings";

/** The HD and full-resolution bitmaps belong to their caches and are never closed here; the thumbnail is ours. */
export class ImageSources {
  hd: ImageBitmap | null = null;
  hdPath: string | null = null;
  thumbnail: ImageBitmap | null = null;
  thumbnailPath: string | null = null;
  full: ImageBitmap | null = null;
  fullPath: string | null = null;

  constructor(private readonly settings: Pick<ViewerSettings, "path" | "enableFullRes">) {}

  get current(): ImageBitmap | null {
    if (this.settings.enableFullRes && this.full && this.fullPath === this.settings.path) return this.full;
    return this.hd ?? this.thumbnail;
  }

  setHd(path: string, bitmap: ImageBitmap): void {
    this.hd = bitmap;
    this.hdPath = path;
  }

  setThumbnail(path: string, bitmap: ImageBitmap): void {
    this.thumbnail?.close?.();
    this.thumbnail = bitmap;
    this.thumbnailPath = path;
  }

  setFull(path: string, bitmap: ImageBitmap): void {
    this.full = bitmap;
    this.fullPath = path;
  }

  dropThumbnail(): void {
    this.thumbnail?.close?.();
    this.thumbnail = null;
    this.thumbnailPath = null;
  }

  keepOnly(path: string): void {
    if (this.hdPath !== path) {
      this.hd = null;
      this.hdPath = null;
    }
    if (this.thumbnailPath !== path) this.dropThumbnail();
    if (this.fullPath !== path) {
      this.full = null;
      this.fullPath = null;
    }
  }

  clear(): void {
    this.hd = null;
    this.hdPath = null;
    this.full = null;
    this.fullPath = null;
    this.dropThumbnail();
  }
}

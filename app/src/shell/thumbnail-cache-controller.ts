import type { Unsubscribe } from "@warble/core";
import type { ImageBackend } from "@warble/media";
import type { ShellViews } from "./shell-views";

/** Makes visible thumbnails load again after the thumbnail disk cache was cleared from the menu. */
export class ThumbnailCacheController {
  private stopListening: Unsubscribe | null = null;

  constructor(
    private readonly images: Pick<ImageBackend, "onCacheCleared">,
    private readonly thumbnails: { clear(): void },
    private readonly views: Pick<ShellViews, "reloadThumbnails">,
  ) {}

  subscribe(): void {
    this.stopListening = this.images.onCacheCleared((cache) => {
      if (cache !== "thumbnail_disk") return;
      this.thumbnails.clear();
      this.views.reloadThumbnails();
    });
  }

  dispose(): void {
    this.stopListening?.();
    this.stopListening = null;
  }
}

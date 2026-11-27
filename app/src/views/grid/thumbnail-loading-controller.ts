import { isCancellation, type TaskPriority } from "@warble/core";
import { VideoSources, type ThumbnailHandle, type ThumbnailImage } from "@warble/media";

const PRELOAD_MARGIN = "200px";

export interface ThumbnailCardHost {
  readonly path: string;
  readonly isConnected: boolean;
  requestUpdate(): void;
  dispatchEvent(event: Event): boolean;
}

export interface ThumbnailSource {
  cached(path: string): ArrayBuffer | null;
  acquireImage(bytes: ArrayBuffer): ThumbnailImage;
  request(path: string, priority?: TaskPriority): ThumbnailHandle;
}

export interface VideoSource {
  sourceFor(path: string): Promise<string>;
}

/**
 * Loads the card's thumbnail once it comes near the viewport: with high priority
 * while on screen, with normal priority in the margin around it, and cancelled
 * when the card leaves both.
 */
export class ThumbnailLoadingController {
  thumbnailUrl: string | null = null;
  videoUrl: string | null = null;
  error: string | null = null;
  private loading = false;
  private visible = false;
  private loadedPath: string | null = null;
  private pending: ThumbnailHandle | null = null;
  private image: ThumbnailImage | null = null;
  private nearbyObserver: IntersectionObserver | null = null;
  private visibilityObserver: IntersectionObserver | null = null;

  constructor(
    private readonly host: ThumbnailCardHost & Element,
    private readonly thumbnails: ThumbnailSource,
    private readonly videos: VideoSource,
  ) {}

  connect(): void {
    this.startObserving();
  }

  disconnect(): void {
    this.stopObserving();
    this.nearbyObserver = null;
    this.visibilityObserver = null;
    this.visible = false;
    this.pending?.cancel();
    this.pending = null;
    this.clearThumbnailUrl();
    this.videoUrl = null;
    this.loadedPath = null;
    this.loading = false;
    this.host.requestUpdate();
  }

  /** Drops the shown image and fetches it again, for example after the thumbnail cache was cleared. */
  reload(): void {
    this.pending?.cancel();
    this.pending = null;
    this.clearThumbnailUrl();
    this.videoUrl = null;
    this.error = null;
    this.loading = false;
    this.loadedPath = null;
    this.host.requestUpdate();
    if (this.host.isConnected) this.startObserving();
  }

  pathChanged(): void {
    if (this.host.path !== this.loadedPath) this.reload();
  }

  private startObserving(): void {
    this.stopObserving();
    const path = this.host.path;
    const cached = this.thumbnails.cached(path);
    if (cached) {
      this.showThumbnail(cached, path);
      return;
    }
    this.visible = false;
    this.visibilityObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        this.visible = entry.isIntersecting;
        this.pending?.setPriority(this.visible ? "high" : "normal");
        if (this.visible) void this.loadThumbnail();
      }
    });
    this.visibilityObserver.observe(this.host);
    this.nearbyObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) void this.loadThumbnail();
          else if (!this.visible) this.cancelPending();
        }
      },
      { rootMargin: PRELOAD_MARGIN },
    );
    this.nearbyObserver.observe(this.host);
  }

  private stopObserving(): void {
    this.nearbyObserver?.disconnect();
    this.visibilityObserver?.disconnect();
  }

  private cancelPending(): void {
    if (!this.pending) return;
    this.pending.cancel();
    this.pending = null;
    this.loading = false;
  }

  private async loadThumbnail(): Promise<void> {
    const path = this.host.path;
    if (this.loading || this.loadedPath === path) return;
    this.loading = true;
    if (VideoSources.isVideo(path)) await this.loadVideo(path);
    else await this.loadImage(path);
  }

  private async loadVideo(path: string): Promise<void> {
    try {
      const url = await this.videos.sourceFor(path);
      if (this.host.path !== path || !this.host.isConnected) return;
      this.videoUrl = url;
      this.loadedPath = path;
      this.host.requestUpdate();
      this.announce("thumbnail-load");
    } catch (error) {
      if (this.host.path !== path) return;
      this.error = String(error);
      this.loadedPath = path;
      this.host.requestUpdate();
    } finally {
      if (this.host.path === path) this.loading = false;
    }
  }

  private async loadImage(path: string): Promise<void> {
    const handle = this.thumbnails.request(path, this.visible ? "high" : "normal");
    this.pending = handle;
    try {
      const bytes = await handle.promise;
      if (this.host.path !== path || this.pending !== handle) return;
      this.showThumbnail(bytes, path);
    } catch (error) {
      if (isCancellation(error) || this.host.path !== path || this.pending !== handle) return;
      this.error = String(error);
      this.loadedPath = path;
      this.host.requestUpdate();
      this.announce("thumbnail-error");
    } finally {
      if (this.pending === handle) {
        this.pending = null;
        this.loading = false;
        if (this.loadedPath === path) this.stopObserving();
      }
    }
  }

  private showThumbnail(bytes: ArrayBuffer, path: string): void {
    this.clearThumbnailUrl();
    this.image = this.thumbnails.acquireImage(bytes);
    this.thumbnailUrl = this.image.url;
    this.loadedPath = path;
    this.host.requestUpdate();
    this.announce("thumbnail-load");
  }

  private clearThumbnailUrl(): void {
    this.image?.release();
    this.image = null;
    this.thumbnailUrl = null;
  }

  private announce(type: "thumbnail-load" | "thumbnail-error"): void {
    this.host.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true }));
  }
}

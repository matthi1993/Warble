import type { FullImageUpgrade } from "./full-image-upgrade";
import type { ImageDisplay } from "./image-display";
import type { ImageLoadingPort } from "./image-loading-port";
import type { ImageSources } from "./image-sources";
import type { ViewerSettings } from "./viewer-settings";

export type LoadStatus = "idle" | "loading" | "ready" | "error";

export interface ImageLoaderHost extends Pick<ViewerSettings, "path" | "enableFullRes"> {
  requestUpdate(): void;
  dispatchEvent(event: Event): boolean;
}

/** The thumbnail first so something shows at once, then the HD preview, then full resolution after a delay. */
export class ImageLoader {
  status: LoadStatus = "idle";
  errorMessage = "";
  private abort: AbortController | null = null;

  constructor(
    private readonly host: ImageLoaderHost,
    private readonly display: ImageDisplay,
    private readonly images: ImageLoadingPort,
    private readonly sources: ImageSources,
    private readonly upgrade: FullImageUpgrade,
  ) {}

  get ready(): boolean {
    return this.status === "ready" && this.sources.hdPath === this.host.path;
  }

  reload(): void {
    this.sources.clear();
    this.start();
  }

  start(): void {
    this.abort?.abort();
    this.display.releaseImage();
    this.upgrade.cancel();
    const abort = new AbortController();
    this.abort = abort;

    const path = this.host.path;
    if (!path) {
      this.setStatus("idle");
      this.sources.clear();
      this.display.redraw();
      return;
    }
    this.setStatus("loading");
    this.sources.keepOnly(path);

    const cached = this.images.cachedHd(path);
    if (cached) {
      this.sources.setHd(path, cached);
      this.setStatus("ready");
      this.display.showImage();
      this.display.warmup();
      this.upgrade.schedule(path, abort);
      this.announce("image-ready", path);
      return;
    }
    this.display.redraw();
    this.loadThumbnail(path, abort);
    void this.loadHd(path, abort);
    this.upgrade.schedule(path, abort);
  }

  stop(): void {
    this.abort?.abort();
    this.upgrade.cancel();
  }

  /** Follows `enableFullRes`: upgrades the photo being shown, or stops upgrading. Returns whether it upgrades. */
  followFullResolution(): boolean {
    if (this.host.enableFullRes && this.host.path && this.abort) {
      this.upgrade.schedule(this.host.path, this.abort);
      return true;
    }
    this.upgrade.cancel();
    return false;
  }

  private loadThumbnail(path: string, abort: AbortController): void {
    const request = this.images.loadThumbnail(path);
    const cancel = () => request.cancel();
    abort.signal.addEventListener("abort", cancel, { once: true });
    void request.promise
      .then((bitmap) => {
        const superseded = abort.signal.aborted || this.host.path !== path || this.sources.hdPath === path;
        if (superseded) {
          bitmap.close?.();
          return;
        }
        this.sources.setThumbnail(path, bitmap);
        this.display.showImage();
      })
      .catch((error) => {
        if (!this.images.isCancellation(error)) console.warn("thumbnail preview failed", error);
      })
      .finally(() => abort.signal.removeEventListener("abort", cancel));
  }

  private async loadHd(path: string, abort: AbortController): Promise<void> {
    try {
      const bitmap = await this.images.loadHd(path, abort.signal);
      if (abort.signal.aborted || this.host.path !== path) return;
      this.sources.setHd(path, bitmap);
      this.sources.dropThumbnail();
      this.setStatus("ready");
      this.display.showImage();
      this.display.warmup();
      this.announce("image-ready", path);
    } catch (error) {
      if (abort.signal.aborted || this.host.path !== path) return;
      console.error("HD preview load failed", error);
      this.setStatus("error", String(error));
      this.announce("image-error", path);
    }
  }

  private setStatus(status: LoadStatus, errorMessage = ""): void {
    if (this.status === status && this.errorMessage === errorMessage) return;
    this.status = status;
    this.errorMessage = errorMessage;
    this.host.requestUpdate();
  }

  private announce(type: "image-ready" | "image-error", path: string): void {
    this.host.dispatchEvent(new CustomEvent(type, { detail: { path } }));
  }
}

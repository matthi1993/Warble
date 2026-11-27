import type { ImageDisplay } from "./image-display";
import type { ImageLoadingPort } from "./image-loading-port";
import type { ImageSources } from "./image-sources";
import type { ViewerSettings } from "./viewer-settings";

export const FULL_IMAGE_DELAY_MS = 1000;

export interface FullImageUpgradeHost extends Pick<ViewerSettings, "path" | "enableFullRes"> {
  requestUpdate(): void;
}

/**
 * Replaces the HD preview with the full-resolution image once a photo has been
 * shown for a while, so quick navigation never starts a full decode. A cached
 * full image waits too, so every photo upgrades the same way.
 */
export class FullImageUpgrade {
  private pending = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private abort: AbortController | null = null;

  constructor(
    private readonly host: FullImageUpgradeHost,
    private readonly display: Pick<ImageDisplay, "upgradeSource">,
    private readonly images: ImageLoadingPort,
    private readonly sources: ImageSources,
  ) {}

  get loading(): boolean {
    return this.pending;
  }

  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.abort?.abort();
    this.abort = null;
    this.setLoading(false);
  }

  schedule(path: string, parent: AbortController): void {
    if (!this.host.enableFullRes || parent.signal.aborted) return;
    if (this.timer !== null || this.abort !== null) return;
    if (this.sources.fullPath === path && this.sources.full) return;
    this.setLoading(true);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.start(path, parent);
    }, FULL_IMAGE_DELAY_MS);
  }

  private start(path: string, parent: AbortController): void {
    if (parent.signal.aborted || this.host.path !== path) {
      this.setLoading(false);
      return;
    }
    const cached = this.images.cachedFull(path);
    if (cached) {
      this.show(path, cached);
      this.setLoading(false);
      return;
    }
    const abort = new AbortController();
    this.abort = abort;
    const abortWithParent = () => abort.abort();
    parent.signal.addEventListener("abort", abortWithParent, { once: true });
    void this.images
      .loadFull(path, abort.signal)
      .then((bitmap) => {
        if (!abort.signal.aborted && this.host.path === path) this.show(path, bitmap);
      })
      .catch((error) => {
        if (!abort.signal.aborted) console.warn("full-resolution image load failed", error);
      })
      .finally(() => {
        parent.signal.removeEventListener("abort", abortWithParent);
        if (this.abort === abort) this.abort = null;
        if (this.host.path === path) this.setLoading(false);
      });
  }

  private show(path: string, bitmap: ImageBitmap): void {
    this.display.upgradeSource(() => this.sources.setFull(path, bitmap));
  }

  private setLoading(loading: boolean): void {
    if (this.pending === loading) return;
    this.pending = loading;
    this.host.requestUpdate();
  }
}

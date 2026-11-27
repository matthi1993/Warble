import { isCancellation } from "@warble/core";
import { VideoSources } from "../video/video-sources";
import { HD_PRELOAD_COUNT, type HdImageCache } from "./hd-image-cache";

interface RunningPreload {
  path: string;
  abort: AbortController;
}

export class HdImagePreloader {
  private currentPath: string | null = null;
  private releaseCurrent: (() => void) | null = null;
  private paths: string[] = [];
  private ready = false;
  private readonly failed = new Set<string>();
  private running: RunningPreload | null = null;

  constructor(private readonly images: HdImageCache) {}

  update(currentPath: string | null, upcoming: readonly string[], ready: boolean): void {
    if (this.currentPath !== currentPath) {
      this.releaseCurrent?.();
      this.currentPath = currentPath;
      this.releaseCurrent = currentPath ? this.images.retain(currentPath) : null;
      this.failed.clear();
    }
    this.paths = currentPath
      ? [...new Set(upcoming)]
          .filter((path) => path !== currentPath && !VideoSources.isVideo(path))
          .slice(0, HD_PRELOAD_COUNT)
      : [];
    this.ready = ready && currentPath !== null;
    if (this.running && this.running.path !== currentPath && !this.paths.includes(this.running.path)) {
      this.running.abort.abort();
    }
    this.preloadNext();
  }

  stop(): void {
    this.update(null, [], false);
  }

  private preloadNext(): void {
    if (!this.ready || this.running) return;
    const path = this.paths.find((candidate) => !this.failed.has(candidate) && !this.images.get(candidate));
    if (!path) return;
    const preload: RunningPreload = { path, abort: new AbortController() };
    this.running = preload;
    void this.preload(preload);
  }

  private async preload({ path, abort }: RunningPreload): Promise<void> {
    try {
      await this.images.load(path, { signal: abort.signal, priority: "background" });
    } catch (error) {
      if (!abort.signal.aborted) {
        this.failed.add(path);
        if (!isCancellation(error)) console.warn("HD preview preload failed", path, error);
      }
    } finally {
      this.running = null;
      this.preloadNext();
    }
  }
}

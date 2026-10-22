import { getHdImage, HD_PRELOAD_COUNT, loadHdImage, retainHdImage } from "./hd-image-cache";
import { isVideoPath } from "./video-source";
import { isTaskCancellation } from "@services/tasks/task-manager";

export class HdImagePreloader {
  private currentPath: string | null = null;
  private releaseCurrent: (() => void) | null = null;
  private paths: string[] = [];
  private ready = false;
  private failed = new Set<string>();
  private running: { path: string; abort: AbortController } | null = null;

  update(currentPath: string | null, upcoming: readonly string[], ready: boolean): void {
    if (this.currentPath !== currentPath) {
      this.releaseCurrent?.();
      this.currentPath = currentPath;
      this.releaseCurrent = currentPath ? retainHdImage(currentPath) : null;
      this.failed.clear();
    }
    this.paths = currentPath
      ? [...new Set(upcoming)].filter((path) => path !== currentPath && !isVideoPath(path)).slice(0, HD_PRELOAD_COUNT)
      : [];
    this.ready = ready && currentPath !== null;
    if (this.running && this.running.path !== currentPath && !this.paths.includes(this.running.path)) {
      this.running.abort.abort();
    }
    this.pump();
  }

  stop(): void {
    this.update(null, [], false);
  }

  private pump(): void {
    if (!this.ready || this.running) return;
    const path = this.paths.find((path) => !this.failed.has(path) && !getHdImage(path));
    if (!path) return;
    const request = { path, abort: new AbortController() };
    this.running = request;
    void (async () => {
      try {
        await loadHdImage(path, { signal: request.abort.signal, priority: "background" });
      } catch (error) {
        if (!request.abort.signal.aborted) {
          this.failed.add(path);
          if (!isTaskCancellation(error)) console.warn("HD preview preload failed", path, error);
        }
      } finally {
        this.running = null;
        this.pump();
      }
    })();
  }
}

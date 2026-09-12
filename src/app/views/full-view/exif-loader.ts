/**
 * Lightweight EXIF loader that mirrors the latest metadata for a
 * single "active path", cancelling stale loads on path changes.
 *
 * Extracted from `pf-full-view` so the orchestrator doesn't carry
 * per-photo async load bookkeeping inline.
 */
import type { ExifMetadata } from "@domain/exif";
import { fetchExif } from "@services/exif/exif-service";
import {
  beginTask,
  cancelTaskRequest,
  nextRequestId,
} from "../../task-manager";

export class ExifLoader {
  private currentPath: string | null = null;
  private currentAbort: AbortController | null = null;
  private gen = 0;
  exif: ExifMetadata | null = null;

  constructor(private readonly onChange: () => void) {}

  /** Sync the loader to the given path. Cancels any in-flight load
   *  for a different path. Returns immediately. */
  syncToPath(path: string | null): void {
    if (path == null) {
      this.currentAbort?.abort();
      this.currentAbort = null;
      if (this.currentPath !== null) {
        this.exif = null;
        this.currentPath = null;
        this.gen++;
        this.onChange();
      }
      return;
    }
    if (path === this.currentPath) return;
    this.currentAbort?.abort();
    this.currentPath = path;
    this.exif = null;
    const gen = ++this.gen;
    const abort = new AbortController();
    this.currentAbort = abort;
    const requestId = nextRequestId();
    this.onChange();
    const task = beginTask({
      kind: "exif",
      label: "Reading EXIF data",
      priority: "urgent",
      target: path,
    });
    const onAbort = () => {
      cancelTaskRequest(requestId);
      task.finish("cancelled");
    };
    abort.signal.addEventListener("abort", onAbort, { once: true });
    void fetchExif(path, requestId)
      .then((meta) => {
        if (abort.signal.aborted || gen !== this.gen) return;
        this.exif = meta;
        this.onChange();
      })
      .catch((err) => {
        if (abort.signal.aborted || gen !== this.gen) return;
        task.finish("failed");
        console.warn("Failed to read EXIF metadata", err);
        this.exif = {};
        this.onChange();
      })
      .finally(() => {
        abort.signal.removeEventListener("abort", onAbort);
        if (this.currentAbort === abort) this.currentAbort = null;
        task.finish();
      });
  }
}

/**
 * Lightweight EXIF loader that mirrors the latest metadata for a
 * single "active path", cancelling stale loads on path changes.
 *
 * Extracted from `pf-full-view` so the orchestrator doesn't carry
 * per-photo async load bookkeeping inline.
 */
import type { ExifMetadata } from "@domain/exif";
import { fetchExif } from "@services/exif/exif-service";

export class ExifLoader {
  private currentPath: string | null = null;
  private gen = 0;
  exif: ExifMetadata | null = null;

  constructor(private readonly onChange: () => void) {}

  /** Sync the loader to the given path. Cancels any in-flight load
   *  for a different path. Returns immediately. */
  syncToPath(path: string | null): void {
    if (path == null) {
      if (this.currentPath !== null) {
        this.exif = null;
        this.currentPath = null;
        this.gen++;
        this.onChange();
      }
      return;
    }
    if (path === this.currentPath) return;
    this.currentPath = path;
    this.exif = null;
    const gen = ++this.gen;
    this.onChange();
    void fetchExif(path)
      .then((meta) => {
        if (gen !== this.gen) return;
        this.exif = meta;
        this.onChange();
      })
      .catch((err) => {
        if (gen !== this.gen) return;
        console.warn("Failed to read EXIF metadata", err);
        this.exif = {};
        this.onChange();
      });
  }
}

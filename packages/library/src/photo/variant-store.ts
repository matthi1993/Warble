import { Emitter, type Unsubscribe } from "@warble/core";
import type { VariantBackend } from "../ports/variant-backend";
import type { PhotoFormat } from "./variants";

export interface VariantPref {
  format: PhotoFormat;
  variant: string;
}

export class VariantStore {
  private readonly overrides = new Map<string, VariantPref>();
  private readonly changes = new Emitter<void>();
  private loaded = false;
  private loadPromise: Promise<void> | null = null;

  constructor(
    private readonly backend: Pick<VariantBackend, "getPhotoVariants" | "setPhotoVariant">,
  ) {}

  load(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.backend
      .getPhotoVariants()
      .then((rows) => {
        for (const row of rows) {
          if (!isFormat(row.format)) continue;
          this.overrides.set(row.path, { format: row.format, variant: row.variant });
        }
        this.loaded = true;
        this.changes.emit();
      })
      .catch((error) => {
        console.error("Failed to load photo variant preferences", error);
        // A transient failure must not cause a retry on every later call.
        this.loaded = true;
      });
    return this.loadPromise;
  }

  reload(): Promise<void> {
    this.overrides.clear();
    this.loaded = false;
    this.loadPromise = null;
    return this.load();
  }

  get(path: string): VariantPref | null {
    return this.overrides.get(path) ?? null;
  }

  set(path: string, pref: VariantPref): void {
    const existing = this.overrides.get(path);
    if (existing && existing.format === pref.format && existing.variant === pref.variant) return;
    this.overrides.set(path, pref);
    this.changes.emit();
    void this.backend
      .setPhotoVariant(path, pref.format, pref.variant)
      .catch((error) => console.error("Failed to persist photo variant", error));
  }

  subscribe(listener: () => void): Unsubscribe {
    return this.changes.subscribe(listener);
  }
}

function isFormat(format: string): format is PhotoFormat {
  return format === "jpg";
}

import type { Photo, VariantPref } from "@warble/library";
import type { CatalogChangeKind, FullViewEvents } from "@app/views/full-view/full-view-events";
import type { SlideOverlay } from "@app/views/full-view/slide-overlay";
import { StageModel } from "@app/views/full-view/stage-model";
import { VariantResolver } from "@app/views/full-view/variant-resolver";

/** A photo whose first file is the base JPEG, followed by one JPEG per named variant. */
export function photo(name: string, variants: string[] = []): Photo {
  const base = `${name}.jpg`;
  return {
    path: base,
    filename: base,
    files: [
      { path: base, extension: "jpg", variant: "base" },
      ...variants.map((variant) => ({ path: `${name} (${variant}).jpg`, extension: "jpg", variant })),
    ],
  };
}

export function video(name: string): Photo {
  const path = `${name}.mov`;
  return { path, filename: path, files: [{ path, extension: "mov", variant: "base" }] };
}

export class CountingHost {
  updates = 0;
  readonly updateComplete = Promise.resolve(true);

  requestUpdate(): void {
    this.updates++;
  }
}

export class FakeStage {
  readonly sequence: { photos: Photo[]; index: number };
  readonly preferences = new Map<string, VariantPref>();
  readonly resolver = new VariantResolver({ get: (path) => this.preferences.get(path) ?? null });
  readonly model: StageModel;

  constructor(photos: Photo[], index = 0) {
    this.sequence = { photos, index };
    this.model = new StageModel(this.sequence, this.resolver);
  }
}

export class RecordingEvents implements FullViewEvents {
  readonly navigations: number[] = [];
  readonly controlsHidden: boolean[] = [];
  readonly catalogChanges: Array<{ kind: CatalogChangeKind; photoPath: string; previousIndex: number }> = [];
  readonly requests: string[] = [];

  navigate(index: number): void {
    this.navigations.push(index);
  }

  slideshowStart(): void {
    this.requests.push("slideshow-start");
  }

  toggleWindowFullscreen(): void {
    this.requests.push("toggle-window-fullscreen");
  }

  toggleImmersiveView(): void {
    this.requests.push("toggle-immersive-view");
  }

  controlsVisibility(hidden: boolean): void {
    this.controlsHidden.push(hidden);
  }

  async catalogChanged(kind: CatalogChangeKind, changed: Photo, previousIndex: number): Promise<void> {
    this.catalogChanges.push({ kind, photoPath: changed.path, previousIndex });
  }
}

export class RecordingOverlay implements SlideOverlay {
  readonly calls: string[] = [];

  capture(): void {
    this.calls.push("capture");
  }

  hide(): void {
    this.calls.push("hide");
  }

  fadeOut(): void {
    this.calls.push("fadeOut");
  }
}

/** Lets pending promise chains run without advancing timers, which a test may have faked. */
export async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

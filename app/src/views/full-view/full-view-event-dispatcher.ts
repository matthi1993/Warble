import type { Photo } from "@warble/library";
import type { CatalogChangeKind, FullViewEvents } from "./full-view-events";

export class FullViewEventDispatcher implements FullViewEvents {
  constructor(private readonly target: EventTarget) {}

  navigate(index: number): void {
    this.dispatch("full-view-navigate", { index });
  }

  slideshowStart(): void {
    this.dispatch("slideshow-start");
  }

  toggleWindowFullscreen(): void {
    this.dispatch("toggle-window-fullscreen");
  }

  toggleImmersiveView(): void {
    this.dispatch("toggle-immersive-view");
  }

  controlsVisibility(hidden: boolean): void {
    this.dispatch("full-view-controls-visibility", { hidden });
  }

  catalogChanged(kind: CatalogChangeKind, photo: Photo, previousIndex: number): Promise<void> {
    let completion = Promise.resolve();
    this.dispatch("photo-catalog-changed", {
      kind,
      photoPath: photo.path,
      memberPaths: photo.files?.map((file) => file.path) ?? [photo.path],
      previousIndex,
      waitUntil: (operation: Promise<void>) => {
        completion = operation;
      },
    });
    return completion;
  }

  private dispatch(type: string, detail?: unknown): void {
    this.target.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
}

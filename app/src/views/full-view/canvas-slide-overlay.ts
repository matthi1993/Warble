import type { SlideOverlay } from "./slide-overlay";

type CanvasLookup = () => HTMLCanvasElement | null;

export class CanvasSlideOverlay implements SlideOverlay {
  constructor(
    private readonly overlay: CanvasLookup,
    private readonly source: CanvasLookup,
  ) {}

  capture(): void {
    const overlay = this.overlay();
    if (!overlay) return;
    const source = this.source();
    if (!source) {
      overlay.style.display = "none";
      return;
    }
    // While the overlay is already fully shown it holds the slide the viewer still sees; keep that one.
    if (overlay.style.display !== "block" || overlay.style.opacity !== "1") {
      overlay.width = source.width;
      overlay.height = source.height;
      overlay.getContext("2d")?.drawImage(source, 0, 0);
    }
    overlay.style.transition = "none";
    overlay.style.opacity = "1";
    overlay.style.display = "block";
  }

  hide(): void {
    const overlay = this.overlay();
    if (overlay) overlay.style.display = "none";
  }

  fadeOut(stillWanted: () => boolean): void {
    const overlay = this.overlay();
    if (!overlay) return;
    requestAnimationFrame(() => {
      if (!stillWanted()) return;
      overlay.style.transition = "opacity 500ms ease";
      overlay.style.opacity = "0";
    });
  }
}

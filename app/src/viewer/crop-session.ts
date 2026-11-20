import type { CropFrame } from "@warble/render";
import type { ViewerEdits } from "./viewer-edits";
import type { ViewerGeometry } from "./viewer-geometry";
import type { ViewerSettings } from "./viewer-settings";

export interface CropSessionHost extends Pick<ViewerSettings, "cropAspect"> {
  dispatchEvent(event: Event): boolean;
}

export class CropSession {
  frame: CropFrame | null = null;

  constructor(
    private readonly host: CropSessionHost,
    private readonly edits: ViewerEdits,
    private readonly geometry: ViewerGeometry,
  ) {}

  begin(): void {
    const saved = this.edits.savedCrop;
    this.frame = saved
      ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
      : this.initialFrame();
  }

  end(): void {
    this.frame = null;
  }

  initialFrame(): CropFrame | null {
    return this.geometry.rotatedBounds()?.largestFrame(this.host.cropAspect) ?? null;
  }

  /** Keeps a frame free of the blank corners a rotation adds. */
  constrain(proposed: CropFrame, fallback: CropFrame): CropFrame {
    return this.geometry.rotatedBounds()?.constrain(proposed, fallback) ?? proposed;
  }

  /** Keeps the user's frame where it still fits the newly rotated image. */
  followRotation(): void {
    const fallback = this.initialFrame();
    this.frame = this.frame && fallback ? this.constrain(this.frame, fallback) : fallback;
    this.announceChange();
  }

  announceChange(): void {
    if (!this.frame) return;
    this.host.dispatchEvent(
      new CustomEvent<CropFrame>("crop-change", { bubbles: true, detail: { ...this.frame } }),
    );
  }
}

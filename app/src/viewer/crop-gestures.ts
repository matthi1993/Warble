import { CropFrameDrag, type CropHandle } from "@warble/render";
import { cropHandleAt, cursorForHandle } from "./crop-handles";
import type { CropSession } from "./crop-session";
import type { HorizonGesture } from "./horizon-gesture";
import type { ViewerScene } from "./viewer-scene";
import type { ViewerCursor, ViewerSettings } from "./viewer-settings";
import type { Point } from "./viewer-surface";

const HANDLE_TOLERANCE = 14;

export interface CropGesturesHost extends Pick<ViewerSettings, "cropAspect" | "horizonMode"> {
  cursor: ViewerCursor;
  dispatchEvent(event: Event): boolean;
}

export class CropGestures {
  private drag: CropFrameDrag | null = null;

  constructor(
    private readonly host: CropGesturesHost,
    private readonly scene: ViewerScene,
    private readonly crop: CropSession,
    private readonly horizon: HorizonGesture,
  ) {}

  readonly onHover = (event: PointerEvent): void => {
    if (this.drag || this.horizon.line) return;
    if (this.host.horizonMode) {
      this.host.cursor = "horizon";
      return;
    }
    const point = this.scene.imagePoint(event.clientX, event.clientY);
    this.host.cursor = point ? cursorForHandle(this.handleAt(point)) : "";
  };

  begin(event: PointerEvent): void {
    if (this.host.horizonMode) {
      this.horizon.begin(event);
      return;
    }
    if (!this.crop.frame) return;
    const point = this.scene.imagePoint(event.clientX, event.clientY);
    const handle = point && this.handleAt(point);
    if (!point || !handle) return;
    this.drag = new CropFrameDrag(handle, point.x, point.y, { ...this.crop.frame });
    const canvas = this.scene.surface.canvas;
    canvas.setPointerCapture(event.pointerId);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onEnd);
    canvas.addEventListener("pointercancel", this.onEnd);
  }

  cancel(): void {
    this.drag = null;
  }

  private handleAt(point: Point): CropHandle | null {
    const frame = this.crop.frame;
    const image = this.scene.imageRect();
    if (!frame || !image) return null;
    const tolerance = HANDLE_TOLERANCE * this.scene.surface.pixelRatio;
    return cropHandleAt(frame, point, tolerance / image.width, tolerance / image.height);
  }

  private readonly onMove = (event: PointerEvent): void => {
    const point = this.scene.imagePoint(event.clientX, event.clientY);
    const image = this.scene.geometry.image()?.source;
    if (!this.drag || !this.crop.frame || !point || !image) return;
    const { frame, orientationFlipped } = this.drag.moveTo(point.x, point.y, this.host.cropAspect, image);
    if (orientationFlipped) this.host.dispatchEvent(new CustomEvent("orientation-flip", { bubbles: true }));
    this.crop.frame = this.crop.constrain(frame, this.drag.startFrame);
    this.scene.redraw();
    this.crop.announceChange();
  };

  private readonly onEnd = (event: PointerEvent): void => {
    this.drag = null;
    const canvas = this.scene.surface.canvas;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {
      // Best-effort: the pointer may already be gone.
    }
    canvas.removeEventListener("pointermove", this.onMove);
    canvas.removeEventListener("pointerup", this.onEnd);
    canvas.removeEventListener("pointercancel", this.onEnd);
    this.crop.announceChange();
    this.host.dispatchEvent(new CustomEvent("crop-commit", { bubbles: true }));
  };
}

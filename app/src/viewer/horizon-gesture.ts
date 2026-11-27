import type { HorizonLine } from "@warble/render";
import type { ViewerScene } from "./viewer-scene";

export interface HorizonGestureHost {
  dispatchEvent(event: Event): boolean;
}

export class HorizonGesture {
  line: HorizonLine | null = null;

  constructor(
    private readonly host: HorizonGestureHost,
    private readonly scene: ViewerScene,
  ) {}

  begin(event: PointerEvent): void {
    const point = this.scene.imagePoint(event.clientX, event.clientY);
    if (!point) return;
    this.line = { ax: point.x, ay: point.y, bx: point.x, by: point.y };
    const canvas = this.scene.surface.canvas;
    canvas.setPointerCapture(event.pointerId);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onEnd);
    canvas.addEventListener("pointercancel", this.onEnd);
    this.scene.redraw();
  }

  private readonly onMove = (event: PointerEvent): void => {
    if (!this.line) return;
    const point = this.scene.imagePoint(event.clientX, event.clientY);
    if (!point) return;
    this.line.bx = point.x;
    this.line.by = point.y;
    this.scene.redraw();
  };

  private readonly onEnd = (event: PointerEvent): void => {
    const line = this.line;
    this.line = null;
    const canvas = this.scene.surface.canvas;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {
      // Best-effort: the pointer may already be gone.
    }
    canvas.removeEventListener("pointermove", this.onMove);
    canvas.removeEventListener("pointerup", this.onEnd);
    canvas.removeEventListener("pointercancel", this.onEnd);
    const image = this.scene.geometry.image()?.source;
    if (!line || !image) return;
    // Pixel distances, so the image's aspect does not tilt the angle.
    const dx = (line.bx - line.ax) * image.width;
    const dy = (line.by - line.ay) * image.height;
    const tooShort = Math.abs(dx) < 1 && Math.abs(dy) < 1;
    if (!tooShort) {
      this.host.dispatchEvent(
        new CustomEvent<number>("horizon-line", { bubbles: true, detail: levellingRotation(dx, dy) }),
      );
    }
    this.scene.redraw();
  };
}

/** Degrees that level the line against the nearer of horizontal and vertical. */
function levellingRotation(dx: number, dy: number): number {
  let correction = -(Math.atan2(dy, dx) * 180) / Math.PI;
  if (correction > 90) correction -= 180;
  if (correction < -90) correction += 180;
  return correction;
}

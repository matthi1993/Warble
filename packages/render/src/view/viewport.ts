import type { Rect, Size } from "../geometry/rect";
import { imageViewScale, type ImageSizing } from "./image-sizing";

const FIT_TOLERANCE = 1e-3;
const MAX_ZOOM = 20;

export interface ViewportBounds {
  readonly canvas: Size;
  /** The canvas area inside the proofing margin and frame. */
  readonly view: Size;
  /** Size of the shown image region in source pixels; `null` while nothing is shown. */
  readonly image: Size | null;
}

/** Zoom and pan of an image inside a canvas. Offsets are device pixels from the canvas centre. */
export class Viewport {
  scale = 1;
  offsetX = 0;
  offsetY = 0;
  fitScale = 1;
  userInteracted = false;
  private fitForced = false;

  forceFit(): void {
    this.fitForced = true;
  }

  returnToFit(): void {
    this.userInteracted = false;
    this.fitForced = true;
  }

  reset(): void {
    this.returnToFit();
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
  }

  snapToFit(): void {
    this.scale = this.fitScale;
    this.offsetX = 0;
    this.offsetY = 0;
    this.userInteracted = false;
  }

  fit(sizing: ImageSizing, bounds: ViewportBounds): void {
    if (!bounds.image) {
      this.fitScale = 1;
      return;
    }
    this.fitScale = imageViewScale(sizing, bounds.image, bounds.view);
    if (this.fitForced) {
      this.snapToFit();
      this.fitForced = false;
    } else if (!this.userInteracted) {
      this.scale = this.fitScale;
    }
  }

  get minScale(): number {
    return this.fitScale;
  }

  maxScale(pixelRatio: number): number {
    return Math.max(MAX_ZOOM * pixelRatio, this.fitScale * MAX_ZOOM);
  }

  get isFitting(): boolean {
    return Math.abs(this.scale - this.fitScale) < FIT_TOLERANCE;
  }

  zoomAround(x: number, y: number, scale: number, bounds: ViewportBounds): void {
    const centerX = bounds.canvas.width / 2 + this.offsetX;
    const centerY = bounds.canvas.height / 2 + this.offsetY;
    const factor = scale / this.scale;
    this.offsetX = centerX + (x - centerX) * (1 - factor) - bounds.canvas.width / 2;
    this.offsetY = centerY + (y - centerY) * (1 - factor) - bounds.canvas.height / 2;
    this.scale = scale;
    this.clampOffsets(bounds);
  }

  /** Returns whether the clamped placement differs from the current one. */
  place(scale: number, offsetX: number, offsetY: number, bounds: ViewportBounds): boolean {
    const previous = [this.scale, this.offsetX, this.offsetY];
    this.scale = scale;
    this.offsetX = offsetX;
    this.offsetY = offsetY;
    this.clampOffsets(bounds);
    return this.scale !== previous[0] || this.offsetX !== previous[1] || this.offsetY !== previous[2];
  }

  clampOffsets(bounds: ViewportBounds): void {
    if (!bounds.image) return;
    this.offsetX = clampOffset(this.offsetX, bounds.image.width * this.scale, bounds.view.width);
    this.offsetY = clampOffset(this.offsetY, bounds.image.height * this.scale, bounds.view.height);
  }

  imageRect(canvas: Size, image: Size): Rect {
    const width = image.width * this.scale;
    const height = image.height * this.scale;
    return {
      x: canvas.width / 2 + this.offsetX - width / 2,
      y: canvas.height / 2 + this.offsetY - height / 2,
      width,
      height,
    };
  }
}

function clampOffset(offset: number, drawn: number, available: number): number {
  if (drawn <= available) return 0;
  const limit = (drawn - available) / 2;
  if (offset > limit) return limit;
  if (offset < -limit) return -limit;
  return offset;
}

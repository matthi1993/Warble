import type { Rect } from "../../geometry/rect";

export interface Overlay {
  /** `image` is the image's rectangle on the canvas in device pixels. */
  paint(context: CanvasRenderingContext2D, image: Rect, pixelRatio: number): void;
}

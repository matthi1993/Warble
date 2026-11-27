import type { Rect, Size } from "../geometry/rect";

export interface VisibleRegion {
  /** Canvas pixels the image covers. */
  readonly target: Rect;
  /** Source pixels shown in `target`. */
  readonly source: Rect;
  /** Pixels worth rendering: no more than the canvas shows or the source holds. */
  readonly output: Size;
}

/** The part of an image drawn at `image` that lies on the canvas, or `null` when none does. */
export function visibleRegion(image: Rect, canvas: Size, region: Rect): VisibleRegion | null {
  const left = Math.max(0, image.x);
  const top = Math.max(0, image.y);
  const right = Math.min(canvas.width, image.x + image.width);
  const bottom = Math.min(canvas.height, image.y + image.height);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  if (!(width > 0 && height > 0)) return null;
  const startX = (left - image.x) / image.width;
  const startY = (top - image.y) / image.height;
  const endX = (right - image.x) / image.width;
  const endY = (bottom - image.y) / image.height;
  const source = {
    x: region.x + startX * region.width,
    y: region.y + startY * region.height,
    width: (endX - startX) * region.width,
    height: (endY - startY) * region.height,
  };
  return {
    target: { x: left, y: top, width, height },
    source,
    output: {
      width: Math.max(1, Math.min(Math.ceil(width), Math.ceil(source.width))),
      height: Math.max(1, Math.min(Math.ceil(height), Math.ceil(source.height))),
    },
  };
}

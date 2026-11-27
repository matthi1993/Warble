import { clamp, type Rect, type Size } from "./rect";

/** Source pixels selected by a normalised crop; the whole image without one. */
export function cropRegion(image: Size, crop: Rect | null): Rect {
  if (!crop) return { x: 0, y: 0, width: image.width, height: image.height };
  return {
    x: clamp(crop.x, 0, 1) * image.width,
    y: clamp(crop.y, 0, 1) * image.height,
    width: Math.max(1, clamp(crop.width, 0, 1) * image.width),
    height: Math.max(1, clamp(crop.height, 0, 1) * image.height),
  };
}

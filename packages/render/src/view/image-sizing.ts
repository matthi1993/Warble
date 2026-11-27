import type { Size } from "../geometry/rect";

export type ImageSizing = "fit" | "fill" | "hybrid";

const HYBRID_MAX_COVER_ZOOM = 4 / 3;

/** Hybrid covers the view unless that would crop too much of the image. */
export function imageViewScale(sizing: ImageSizing, image: Size, view: Size): number {
  const widthScale = view.width / image.width;
  const heightScale = view.height / image.height;
  const contain = Math.min(widthScale, heightScale);
  const cover = Math.max(widthScale, heightScale);
  return sizing === "fill" || (sizing === "hybrid" && cover / contain <= HYBRID_MAX_COVER_ZOOM)
    ? cover
    : contain;
}

import type { ImageSizing } from "./types";

interface Dimensions {
  width: number;
  height: number;
}

export function imageViewScale(sizing: ImageSizing, image: Dimensions, viewport: Dimensions): number {
  const widthScale = viewport.width / image.width;
  const heightScale = viewport.height / image.height;
  const contain = Math.min(widthScale, heightScale);
  const cover = Math.max(widthScale, heightScale);
  return sizing === "fill" || (sizing === "hybrid" && cover / contain <= 4 / 3)
    ? cover : contain;
}

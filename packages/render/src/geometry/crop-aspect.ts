import type { CropFrame, CropResizeHandle } from "./crop-frame";
import { clamp, type Size } from "./rect";

const MIN_FRAME_SIZE = 0.02;

/** `aspect` is width / height in image pixels. The side opposite the dragged handle stays in place. */
export function enforceAspect(
  proposed: CropFrame,
  start: CropFrame,
  aspect: number,
  handle: CropResizeHandle,
  image: Size,
): CropFrame {
  const west = handle.includes("w");
  const east = handle.includes("e");
  const north = handle.includes("n");
  const south = handle.includes("s");
  const anchorX = west ? start.x + start.width : east ? start.x : start.x + start.width / 2;
  const anchorY = north ? start.y + start.height : south ? start.y : start.y + start.height / 2;
  const placeX = (width: number) => (west ? anchorX - width : east ? anchorX : anchorX - width / 2);
  const placeY = (height: number) => (north ? anchorY - height : south ? anchorY : anchorY - height / 2);
  const heightPerWidth = image.width / image.height / aspect;

  let { width, height } = aspectSize(proposed, handle, heightPerWidth);
  let x = placeX(width);
  let y = placeY(height);
  if (x < 0) {
    width += x;
    height = width * heightPerWidth;
    x = 0;
    y = placeY(height);
  }
  if (y < 0) {
    height += y;
    width = height / heightPerWidth;
    y = 0;
    x = placeX(width);
  }
  if (x + width > 1) {
    width = 1 - x;
    height = width * heightPerWidth;
  }
  if (y + height > 1) {
    height = 1 - y;
    width = height / heightPerWidth;
  }
  return {
    x: clamp(x, 0, 1),
    y: clamp(y, 0, 1),
    width: clamp(width, MIN_FRAME_SIZE, 1),
    height: clamp(height, MIN_FRAME_SIZE, 1),
  };
}

function aspectSize(proposed: CropFrame, handle: CropResizeHandle, heightPerWidth: number): Size {
  const widthFromHeight = proposed.height / heightPerWidth;
  const heightFromWidth = proposed.width * heightPerWidth;
  if (handle === "n" || handle === "s") return { width: widthFromHeight, height: proposed.height };
  if (handle === "e" || handle === "w") return { width: proposed.width, height: heightFromWidth };
  // A corner drag keeps whichever dimension gives the smaller frame.
  return widthFromHeight * proposed.height <= proposed.width * heightFromWidth
    ? { width: widthFromHeight, height: proposed.height }
    : { width: proposed.width, height: heightFromWidth };
}

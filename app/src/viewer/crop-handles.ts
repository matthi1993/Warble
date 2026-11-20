import type { CropFrame, CropHandle } from "@warble/render";
import type { ViewerCursor } from "./viewer-settings";
import type { Point } from "./viewer-surface";

/** `frame` and `point` are in normalised image coordinates. Corners win over edges, edges over moving. */
export function cropHandleAt(
  frame: CropFrame,
  point: Point,
  toleranceX: number,
  toleranceY: number,
): CropHandle | null {
  const left = frame.x;
  const right = frame.x + frame.width;
  const top = frame.y;
  const bottom = frame.y + frame.height;
  const nearLeft = Math.abs(point.x - left) <= toleranceX;
  const nearRight = Math.abs(point.x - right) <= toleranceX;
  const nearTop = Math.abs(point.y - top) <= toleranceY;
  const nearBottom = Math.abs(point.y - bottom) <= toleranceY;
  const withinRows = point.y >= top - toleranceY && point.y <= bottom + toleranceY;
  const withinColumns = point.x >= left - toleranceX && point.x <= right + toleranceX;
  if (nearLeft && nearTop) return "nw";
  if (nearRight && nearTop) return "ne";
  if (nearLeft && nearBottom) return "sw";
  if (nearRight && nearBottom) return "se";
  if (nearLeft && withinRows) return "w";
  if (nearRight && withinRows) return "e";
  if (nearTop && withinColumns) return "n";
  if (nearBottom && withinColumns) return "s";
  const inside = point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
  return inside ? "move" : null;
}

export function cursorForHandle(handle: CropHandle | null): ViewerCursor {
  switch (handle) {
    case "move":
      return "move";
    case "n":
    case "s":
      return "ns";
    case "e":
    case "w":
      return "ew";
    case "nw":
    case "se":
      return "nwse";
    case "ne":
    case "sw":
      return "nesw";
    default:
      return "";
  }
}

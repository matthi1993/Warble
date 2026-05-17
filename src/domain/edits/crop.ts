import type { CropEdit } from "./types";

/** Compare two crop edits for equality, with a small epsilon on the
 *  floating-point frame coordinates and rotation. Used to dedupe
 *  no-op writes that the canvas dispatches on benign prop refreshes. */
export function cropEditsEqual(a: CropEdit, b: CropEdit): boolean {
  const eps = 1e-4;
  return (
    a.aspectRatio === b.aspectRatio &&
    a.orientation === b.orientation &&
    Math.abs(a.x - b.x) < eps &&
    Math.abs(a.y - b.y) < eps &&
    Math.abs(a.width - b.width) < eps &&
    Math.abs(a.height - b.height) < eps &&
    Math.abs((a.rotation ?? 0) - (b.rotation ?? 0)) < eps
  );
}

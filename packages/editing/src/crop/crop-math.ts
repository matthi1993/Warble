import { ASPECT_RATIO_VALUES, type AspectRatioKey, type Orientation } from "./crop-edit";

export function effectiveAspect(aspect: AspectRatioKey, orientation: Orientation): number {
  const landscape = ASPECT_RATIO_VALUES[aspect];
  return orientation === "portrait" ? 1 / landscape : landscape;
}

export function flipOrientation(orientation: Orientation): Orientation {
  return orientation === "landscape" ? "portrait" : "landscape";
}

/** Result stays within (-180, 180]. */
export function rotateQuarterTurn(rotation: number, direction: -1 | 1): number {
  let next = (rotation || 0) + direction * 90;
  while (next > 180) next -= 360;
  while (next <= -180) next += 360;
  return next;
}

/** Folds the corrected angle back into [-45, 45] so a drawn horizon never turns the photo on its side. */
export function applyHorizonCorrection(rotation: number, delta: number): number {
  let next = (rotation || 0) + delta;
  while (next > 45) next -= 90;
  while (next < -45) next += 90;
  return next;
}

/** Replaces the fine angle and keeps the quarter turns already applied. */
export function straighten(rotation: number, degrees: number): number {
  const quarterTurns = Math.round((rotation || 0) / 90) * 90;
  return quarterTurns + degrees;
}

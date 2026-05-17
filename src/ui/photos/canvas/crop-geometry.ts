/**
 * Pure geometry helpers for the crop overlay: numeric clamping plus
 * aspect-locked frame re-derivation. No DOM access; safe to unit-test.
 */
import type { CropFrame } from "./types";

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Enforce an aspect ratio on a freshly-resized crop frame by adjusting
 * the dimension that wasn't directly dragged (or shrinking the one that
 * was, if doing so would push the frame outside the image).
 *
 * `kind` indicates which handle was dragged — corner drags resize both
 * dimensions, edge drags resize one and we recompute the other. The
 * anchor (the corner opposite the dragged handle/edge) stays put.
 */
export function enforceAspect(
  proposed: CropFrame,
  start: CropFrame,
  aspect: number,
  kind: "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw",
  bm: { width: number; height: number }
): CropFrame {
  // Anchor point (opposite the moved handle).
  const startRight = start.x + start.width;
  const startBottom = start.y + start.height;
  let anchorX = start.x + start.width / 2;
  let anchorY = start.y + start.height / 2;
  if (kind.includes("w")) anchorX = startRight;
  else if (kind.includes("e")) anchorX = start.x;
  if (kind.includes("n")) anchorY = startBottom;
  else if (kind.includes("s")) anchorY = start.y;

  // Image aspect (in normalised coords) is bm.width:bm.height ratio,
  // but our normalised coords are 0..1 in each dimension, so a
  // crop-frame width `w` and height `h` in normalised coords represents
  // a true-pixel ratio of (w * bm.width) / (h * bm.height) — we want
  // that = `aspect`, i.e. h / w = (bm.width / bm.height) / aspect.
  const ratio = bm.width / bm.height / aspect; // h/w in normalised space

  let w = proposed.width;
  let h = proposed.height;
  if (kind === "n" || kind === "s") {
    h = proposed.height;
    w = h / ratio;
  } else if (kind === "e" || kind === "w") {
    h = proposed.width * ratio;
    w = proposed.width;
  } else {
    // Corner: pick the dimension that produces the smaller frame
    // (more conservative — keeps within image bounds).
    const wFromH = proposed.height / ratio;
    const hFromW = proposed.width * ratio;
    if (wFromH * proposed.height <= proposed.width * hFromW) {
      w = wFromH;
      h = proposed.height;
    } else {
      w = proposed.width;
      h = hFromW;
    }
  }

  // Re-anchor the frame so the anchor corner/edge stays put.
  let x: number;
  let y: number;
  if (kind.includes("w")) x = anchorX - w;
  else if (kind.includes("e")) x = anchorX;
  else x = anchorX - w / 2;
  if (kind.includes("n")) y = anchorY - h;
  else if (kind.includes("s")) y = anchorY;
  else y = anchorY - h / 2;

  // If the frame escapes the image, shrink to fit while preserving
  // aspect.
  if (x < 0) {
    const shrink = -x;
    w -= shrink;
    h = w * ratio;
    x = 0;
    if (kind.includes("n")) y = anchorY - h;
    else if (kind.includes("s")) y = anchorY;
    else y = anchorY - h / 2;
  }
  if (y < 0) {
    const shrink = -y;
    h -= shrink;
    w = h / ratio;
    y = 0;
    if (kind.includes("w")) x = anchorX - w;
    else if (kind.includes("e")) x = anchorX;
    else x = anchorX - w / 2;
  }
  if (x + w > 1) {
    w = 1 - x;
    h = w * ratio;
  }
  if (y + h > 1) {
    h = 1 - y;
    w = h / ratio;
  }
  return {
    x: clamp(x, 0, 1),
    y: clamp(y, 0, 1),
    width: clamp(w, 0.02, 1),
    height: clamp(h, 0.02, 1),
  };
}

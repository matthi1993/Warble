/**
 * Shared types for the `pf-image-canvas` module and its extracted
 * subsystems (`canvas/` sibling modules). Keeping these in one place
 * avoids circular imports between the host element and the helpers
 * it composes.
 */

export type ImageFit = "contain" | "proof" | "tight";
export type ImageSizing = "fit" | "fill" | "hybrid";
export type ImageSmoothingQuality = "low" | "medium" | "high";

/** Pending crop frame state, exposed via `getCropFrame()`. */
export interface CropFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

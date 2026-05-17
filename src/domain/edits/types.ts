/**
 * Value-object definitions for per-photo non-destructive edits.
 * Pure data — no IO, no DOM. Lives in the domain layer so both the
 * canvas pipeline and the editor UI can depend on these without
 * pulling the persistence service.
 */

export type AspectRatioKey =
  | "3:2"
  | "1:1"
  | "4:3"
  | "16:9"
  | "16:10"
  | "panavision"
  | "super-panavision";

export type Orientation = "landscape" | "portrait";

export interface CropEdit {
  /** Left edge as fraction of original width (0..1). */
  x: number;
  /** Top edge as fraction of original height (0..1). */
  y: number;
  /** Width as fraction of original width (0..1). */
  width: number;
  /** Height as fraction of original height (0..1). */
  height: number;
  /** Aspect-ratio preset that produced this crop (for UI restore). */
  aspectRatio: AspectRatioKey;
  /** Orientation that produced this crop (for UI restore). */
  orientation: Orientation;
  /** Rotation in degrees applied to the source bitmap before the
   * normalised x/y/width/height are interpreted. Combines a 90°
   * snap component (0/90/180/270) with a fine straighten in roughly
   * (-45..+45). */
  rotation: number;
}

/** Tonal adjustments under the "Basic" group in the editor side panel.
 *  All values are in [-100, 100] with `0` meaning "no change".
 *
 *  White-balance is part of the same edit because it shares the same
 *  shader pass; conceptually it is the first stage of the basic
 *  adjustments (temperature shifts blue↔yellow, tint shifts
 *  magenta↔green). */
export interface ToneEdit {
  temperature: number;
  tint: number;
  exposure: number;
  contrast: number;
  saturation: number;
  whites: number;
  highlights: number;
  shadows: number;
  blacks: number;
}

export interface PhotoEdit {
  crop: CropEdit | null;
  tone: ToneEdit | null;
}

export const TONE_KEYS: readonly (keyof ToneEdit)[] = [
  "temperature",
  "tint",
  "exposure",
  "contrast",
  "saturation",
  "whites",
  "highlights",
  "shadows",
  "blacks",
] as const;

export const ASPECT_RATIO_VALUES: Record<AspectRatioKey, number> = {
  "3:2": 3 / 2,
  "1:1": 1,
  "4:3": 4 / 3,
  "16:9": 16 / 9,
  "16:10": 16 / 10,
  panavision: 2.35,
  "super-panavision": 2.76,
};

export const ASPECT_RATIO_LABELS: Record<AspectRatioKey, string> = {
  "3:2": "3:2",
  "1:1": "1:1",
  "4:3": "4:3",
  "16:9": "16:9",
  "16:10": "16:10",
  panavision: "2.35:1",
  "super-panavision": "2.76:1",
};

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
  | "xpan"
  | "panavision";

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
 *  Most values are in [-100, 100] with `0` meaning "no change".
 *  Exposure is stored as hundredths of an EV; the JPEG
 *  UI still exposes the legacy -100..100 compact range.
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
  curve: import("./curve").CurveEdit | null;
  color: import("./color").ColorEdit | null;
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

/** Subset of `TONE_KEYS` rendered inside the "Base Edit" card — the
 *  global look knobs (white balance + overall exposure/contrast/
 *  saturation) that don't target a specific tonal region. */
export const BASE_TONE_KEYS: readonly (keyof ToneEdit)[] = [
  "temperature",
  "tint",
  "exposure",
  "contrast",
  "saturation",
] as const;

/** Subset of `TONE_KEYS` rendered inside the "Dynamic Range" card —
 *  the per-region offsets (whites / highlights / shadows / blacks)
 *  that shape the tonal curve at specific luminance bands. */
export const DYNAMIC_RANGE_KEYS: readonly (keyof ToneEdit)[] = [
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
  // Hasselblad XPan: 65×24mm panoramic frame = 65/24 ≈ 2.7083:1.
  xpan: 65 / 24,
  panavision: 2.35,
};

export const ASPECT_RATIO_LABELS: Record<AspectRatioKey, string> = {
  "3:2": "3:2",
  "1:1": "1:1",
  "4:3": "4:3",
  "16:9": "16:9",
  "16:10": "16:10",
  xpan: "XPan",
  panavision: "Panavision",
};

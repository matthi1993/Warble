export type AspectRatioKey = "3:2" | "1:1" | "4:3" | "16:9" | "16:10" | "xpan" | "panavision";

export type Orientation = "landscape" | "portrait";

/** Frame as fractions of the rotated image; `rotation` in degrees is applied first. */
export interface CropEdit {
  x: number;
  y: number;
  width: number;
  height: number;
  aspectRatio: AspectRatioKey;
  orientation: Orientation;
  rotation: number;
}

export const ASPECT_RATIO_VALUES: Record<AspectRatioKey, number> = {
  "3:2": 3 / 2,
  "1:1": 1,
  "4:3": 4 / 3,
  "16:9": 16 / 9,
  "16:10": 16 / 10,
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

const EQUALITY_TOLERANCE = 1e-4;

export function cropEditsEqual(a: CropEdit, b: CropEdit): boolean {
  const close = (first: number, second: number) => Math.abs(first - second) < EQUALITY_TOLERANCE;
  return (
    a.aspectRatio === b.aspectRatio &&
    a.orientation === b.orientation &&
    close(a.x, b.x) &&
    close(a.y, b.y) &&
    close(a.width, b.width) &&
    close(a.height, b.height) &&
    close(a.rotation ?? 0, b.rotation ?? 0)
  );
}

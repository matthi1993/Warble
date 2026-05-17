/**
 * Per-photo star rating + colour label value objects.
 * Pure data — no IO. The persistence layer lives in the rating service.
 */
export type ColorLabel = "green" | "blue" | "yellow" | "red" | "";

export const COLOR_LABELS: readonly Exclude<ColorLabel, "">[] = [
  "green",
  "blue",
  "yellow",
  "red",
] as const;

/** Hex color for each label. Picked to read well over both light
 *  thumbnails and the dark full-view background. */
export const LABEL_COLORS: Record<Exclude<ColorLabel, "">, string> = {
  green: "#22c55e",
  blue: "#3b82f6",
  yellow: "#eab308",
  red: "#ef4444",
};

export const LABEL_DISPLAY_NAMES: Record<Exclude<ColorLabel, "">, string> = {
  green: "Select",
  blue: "Select 2",
  yellow: "Raw archive",
  red: "Archive",
};

export interface PhotoRating {
  rating: number;
  label: ColorLabel;
  /** Unix epoch seconds at which the rating was last changed. `0`
   * for legacy rows that pre-date the timestamp column. */
  ratedAt: number;
}

export function sanitizeLabel(s: string): ColorLabel {
  return s === "green" || s === "blue" || s === "yellow" || s === "red"
    ? s
    : "";
}

export function clampRating(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(5, Math.round(n)));
}

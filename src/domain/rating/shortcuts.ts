import type { ColorLabel } from "./types";

/**
 * Map keyboard shortcut keys (`0`..`5` for stars, `6`..`9` for color
 * labels) to their actions. Star keys (`0`–`5`) set the rating to
 * that exact value (idempotent); label keys (`6`–`9`) toggle the
 * corresponding color label.
 */
export const KEY_TO_LABEL: Record<string, Exclude<ColorLabel, "">> = {
  "6": "green",
  "7": "blue",
  "8": "yellow",
  "9": "red",
};

export const RATING_LABEL_KEYS: ReadonlySet<string> = new Set([
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
]);

import type { ColorLabel } from "./rating";

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

/** Values are in [-100, 100] with 0 as neutral; exposure is hundredths of an EV. */
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

export const BASE_TONE_KEYS: readonly (keyof ToneEdit)[] = [
  "temperature",
  "tint",
  "exposure",
  "contrast",
  "saturation",
];

export const DYNAMIC_RANGE_KEYS: readonly (keyof ToneEdit)[] = ["whites", "highlights", "shadows", "blacks"];

export const TONE_KEYS: readonly (keyof ToneEdit)[] = [...BASE_TONE_KEYS, ...DYNAMIC_RANGE_KEYS];

export function defaultTone(): ToneEdit {
  return {
    temperature: 0,
    tint: 0,
    exposure: 0,
    contrast: 0,
    saturation: 0,
    whites: 0,
    highlights: 0,
    shadows: 0,
    blacks: 0,
  };
}

export function isToneZero(t: ToneEdit | null | undefined): boolean {
  if (!t) return true;
  for (const k of TONE_KEYS) {
    if (t[k] !== 0) return false;
  }
  return true;
}

export function isBaseToneZero(t: ToneEdit | null | undefined): boolean {
  if (!t) return true;
  for (const k of BASE_TONE_KEYS) {
    if (t[k] !== 0) return false;
  }
  return true;
}

export function isDynamicRangeZero(t: ToneEdit | null | undefined): boolean {
  if (!t) return true;
  for (const k of DYNAMIC_RANGE_KEYS) {
    if (t[k] !== 0) return false;
  }
  return true;
}


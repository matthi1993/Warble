import {
  BASE_TONE_KEYS,
  DYNAMIC_RANGE_KEYS,
  TONE_KEYS,
  type ToneEdit,
} from "./types";

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

/** True when every base-tone slider (white balance + global exposure /
 *  contrast / saturation) is at its neutral value. */
export function isBaseToneZero(t: ToneEdit | null | undefined): boolean {
  if (!t) return true;
  for (const k of BASE_TONE_KEYS) {
    if (t[k] !== 0) return false;
  }
  return true;
}

/** True when every dynamic-range slider (whites / highlights /
 *  shadows / blacks) is at its neutral value. */
export function isDynamicRangeZero(t: ToneEdit | null | undefined): boolean {
  if (!t) return true;
  for (const k of DYNAMIC_RANGE_KEYS) {
    if (t[k] !== 0) return false;
  }
  return true;
}

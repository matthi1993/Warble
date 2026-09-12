import {
  BASE_TONE_KEYS,
  DYNAMIC_RANGE_KEYS,
  TONE_KEYS,
  type ToneEdit,
} from "./types";
import {
  RAW_CONTRAST_SLIDER_RANGE,
  TONE_GLOBAL_RESPONSE,
  TONE_SLIDER_RANGE,
} from "./adjustment-config";

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

export interface ToneControlSpec {
  min: number;
  max: number;
  step: number;
  resetValue: number;
  displayValue: (modelValue: number) => string;
  toModel: (controlValue: number) => number;
  toControl: (modelValue: number) => number;
}

/**
 * UI semantics for tone controls. JPEGs retain the original compact
 * percentage ranges. RAW exposure is expressed in EV and RAW temperature
 * is expressed in Kelvin, while the persisted ToneEdit remains a stable
 * normalized value for backwards compatibility.
 */
export function toneControlSpec(
  key: keyof ToneEdit,
  raw: boolean,
): ToneControlSpec {
  if (!raw) {
    return {
      ...TONE_SLIDER_RANGE,
      displayValue: signedInteger,
      toModel: (value) => value,
      toControl: (value) => value,
    };
  }

  if (key === "exposure") {
    return {
      min: -6,
      max: 6,
      step: 0.01,
      resetValue: 0,
      displayValue: (value) => `${formatSigned(value / TONE_GLOBAL_RESPONSE.exposureScale, 2)} EV`,
      toModel: (value) => value * TONE_GLOBAL_RESPONSE.exposureScale,
      toControl: (value) => value / TONE_GLOBAL_RESPONSE.exposureScale,
    };
  }

  if (key === "temperature") {
    return {
      min: 2500,
      max: 10500,
      step: 50,
      resetValue: 6500,
      displayValue: (value) => `${Math.round(6500 + value * 40)} K`,
      toModel: (value) => (value - 6500) / 40,
      toControl: (value) => 6500 + value * 40,
    };
  }

  if (key === "contrast") {
    return {
      ...RAW_CONTRAST_SLIDER_RANGE,
      displayValue: signedInteger,
      toModel: (value) => value,
      toControl: (value) => value,
    };
  }

  return {
    ...TONE_SLIDER_RANGE,
    displayValue: signedInteger,
    toModel: (value) => value,
    toControl: (value) => value,
  };
}

function signedInteger(value: number): string {
  return value > 0 ? `+${Math.round(value)}` : `${Math.round(value)}`;
}

function formatSigned(value: number, digits: number): string {
  const rounded = value.toFixed(digits);
  return value > 0 ? `+${rounded}` : rounded;
}

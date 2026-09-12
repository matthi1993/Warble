/**
 * Shared tuning for the editor's tonal and colour adjustments.
 *
 * This is the place to adapt slider ranges, adjustment strengths, and
 * regional falloffs. The tone and colour shaders import these values when
 * their GLSL source is composed, so the UI and renderer stay in sync.
 */

export interface SliderRange {
  min: number;
  max: number;
  step: number;
  resetValue: number;
}

export const TONE_SLIDER_RANGE: SliderRange = {
  min: -100,
  max: 100,
  step: 1,
  resetValue: 0,
};

/** RAW contrast deliberately uses a smaller control range than JPEG/base
 * edits because the linear RAW source makes the same contrast value feel
 * considerably stronger. */
export const RAW_CONTRAST_SLIDER_RANGE: SliderRange = {
  min: -50,
  max: 50,
  step: 1,
  resetValue: 0,
};

/** Response scales for the base tone controls. These values are deliberately
 * separate from the UI ranges so the feel of a control can be tuned without
 * changing stored edit values. */
export const TONE_GLOBAL_RESPONSE = {
  valueScale: 100,
  exposureScale: 100,
  contrastScale: 200,
  saturationScale: 100,
  temperatureGain: 0.30,
  tintGain: 0.20,
} as const;

export const COLOR_SLIDER_RESPONSE = {
  valueScale: 100,
  hueShiftDegrees: 30,
} as const;

/**
 * Broad, monotonic luminance masks for the dynamic-range controls.
 *
 * Blacks and shadows fade out as luminance rises. Highlights and whites fade
 * in as luminance rises. In particular, highlights no longer peak and then
 * fall off at the brightest end, which could make bright pixels darker than
 * slightly darker pixels when using a negative highlight value.
 */
export const TONE_REGION_FALLOFFS = {
  blacks: { start: 0.00, end: 0.36, strength: 0.12 },
  shadows: { start: 0.10, end: 0.78, strength: 0.22 },
  highlights: { start: 0.22, end: 0.94, strength: 0.22 },
  whites: { start: 0.56, end: 1.00, strength: 0.16 },
} as const;

/** Multiplier above 1 widens each colour channel's hue transition. */
export const COLOR_HUE_FALLOFF = 1.25;

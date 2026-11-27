export const TONE_GLOBAL_RESPONSE = {
  valueScale: 100,
  exposureScale: 100,
  contrastScale: 200,
  saturationScale: 100,
  temperatureGain: 0.30,
  tintGain: 0.20,
} as const;

/**
 * Monotonic luminance masks: blacks and shadows fade out as luminance rises,
 * highlights and whites fade in, so a negative highlight value can never make
 * a brighter pixel darker than a slightly darker one.
 */
export const TONE_REGION_FALLOFFS = {
  blacks: { start: 0.00, end: 0.36, strength: 0.12 },
  shadows: { start: 0.10, end: 0.78, strength: 0.22 },
  highlights: { start: 0.22, end: 0.94, strength: 0.22 },
  whites: { start: 0.56, end: 1.00, strength: 0.16 },
} as const;

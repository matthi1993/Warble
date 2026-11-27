export interface SliderRange {
  min: number;
  max: number;
  step: number;
  resetValue: number;
}

export const TONE_SLIDER_RANGE: SliderRange = { min: -100, max: 100, step: 1, resetValue: 0 };

export interface ToneControlSpec extends SliderRange {
  displayValue: (modelValue: number) => string;
  toModel: (controlValue: number) => number;
  toControl: (modelValue: number) => number;
}

export function toneControlSpec(): ToneControlSpec {
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

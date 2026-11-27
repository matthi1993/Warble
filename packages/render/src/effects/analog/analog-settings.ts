import { clampAmount } from "../amount";

export interface AnalogSettings {
  vignette: number;
  halation: number;
  chromaticAberration: number;
}

export function defaultAnalog(): AnalogSettings {
  return { vignette: 0, halation: 0, chromaticAberration: 0 };
}

export function normalizeAnalog(value: Partial<AnalogSettings> | null | undefined): AnalogSettings {
  return {
    vignette: clampAmount(value?.vignette),
    halation: clampAmount(value?.halation),
    chromaticAberration: clampAmount(value?.chromaticAberration),
  };
}

export function isAnalogZero(value: AnalogSettings | null | undefined): boolean {
  return !value || Object.values(value).every((amount) => amount === 0);
}

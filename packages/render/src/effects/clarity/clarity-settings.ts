import { clampAmount } from "../amount";

export interface ClaritySettings {
  clarity: number;
  structure: number;
}

export function defaultClarity(): ClaritySettings {
  return { clarity: 0, structure: 0 };
}

export function normalizeClarity(value: Partial<ClaritySettings> | null | undefined): ClaritySettings {
  return { clarity: clampAmount(value?.clarity, -100), structure: clampAmount(value?.structure, -100) };
}

export function isClarityZero(value: ClaritySettings | null | undefined): boolean {
  return !value || (value.clarity === 0 && value.structure === 0);
}

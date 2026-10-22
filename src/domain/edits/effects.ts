export interface ClaritySettings {
  clarity: number;
  structure: number;
}

export function defaultClarity(): ClaritySettings {
  return { clarity: 0, structure: 0 };
}

export function normalizeClarity(value: Partial<ClaritySettings> | null | undefined): ClaritySettings {
  return { clarity: effectAmount(value?.clarity, -100), structure: effectAmount(value?.structure, -100) };
}

export function isClarityZero(value: ClaritySettings | null | undefined): boolean {
  return !value || (value.clarity === 0 && value.structure === 0);
}

export interface AnalogSettings {
  vignette: number;
  halation: number;
  chromaticAberration: number;
}

export function defaultAnalog(): AnalogSettings {
  return { vignette: 0, halation: 0, chromaticAberration: 0 };
}

function effectAmount(value: number | undefined, min = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(100, value)) : 0;
}

export function normalizeAnalog(value: Partial<AnalogSettings> | null | undefined): AnalogSettings {
  return {
    vignette: effectAmount(value?.vignette),
    halation: effectAmount(value?.halation),
    chromaticAberration: effectAmount(value?.chromaticAberration),
  };
}

export function isAnalogZero(value: AnalogSettings | null | undefined): boolean {
  return !value || Object.values(value).every((amount) => amount === 0);
}

export interface SharpenSettings {
  strength: number;
  radius: number;
  threshold: number;
}

export interface GrainSettings {
  size: number;
  amount: number;
  fine: number;
}

export interface BloomSettings {
  strength: number;
  threshold: number;
  radius: number;
  softness: number;
  spread: number;
}

export function defaultBloom(): BloomSettings {
  return { strength: 0, threshold: 68, radius: 50, softness: 45, spread: 60 };
}

export function isBloomZero(bloom: BloomSettings | null | undefined): boolean {
  return !bloom || bloom.strength <= 0;
}

export function defaultGrain(): GrainSettings {
  return { size: 25, amount: 0, fine: 0 };
}

export function isGrainZero(grain: GrainSettings | null | undefined): boolean {
  return !grain || (grain.amount <= 0 && grain.fine <= 0);
}

export function defaultSharpen(): SharpenSettings {
  return { strength: 0, radius: 1, threshold: 0 };
}

export function isSharpenZero(value: SharpenSettings | null | undefined): boolean {
  return !value || value.strength <= 0;
}

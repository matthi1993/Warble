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

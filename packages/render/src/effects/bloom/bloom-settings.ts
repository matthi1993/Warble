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

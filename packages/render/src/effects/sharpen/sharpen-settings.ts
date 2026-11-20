export interface SharpenSettings {
  strength: number;
  radius: number;
  threshold: number;
}

export function defaultSharpen(): SharpenSettings {
  return { strength: 0, radius: 1, threshold: 0 };
}

export function isSharpenZero(value: SharpenSettings | null | undefined): boolean {
  return !value || value.strength <= 0;
}

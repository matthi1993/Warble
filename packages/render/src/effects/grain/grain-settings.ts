export interface GrainSettings {
  size: number;
  amount: number;
  fine: number;
}

export function defaultGrain(): GrainSettings {
  return { size: 25, amount: 0, fine: 0 };
}

export function isGrainZero(grain: GrainSettings | null | undefined): boolean {
  return !grain || (grain.amount <= 0 && grain.fine <= 0);
}

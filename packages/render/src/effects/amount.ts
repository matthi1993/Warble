export function clampAmount(value: number | undefined, min = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(100, value)) : 0;
}

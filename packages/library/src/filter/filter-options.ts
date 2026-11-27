import type { Photo } from "../photo/photo";

export function cameraOptions(photos: readonly Photo[]): string[] {
  return distinctSorted(photos.map((photo) => photo.filterInfo?.camera));
}

export function lensOptions(photos: readonly Photo[]): string[] {
  return distinctSorted(photos.map((photo) => photo.filterInfo?.lens));
}

function distinctSorted(values: (string | null | undefined)[]): string[] {
  const present = values.filter((value): value is string => Boolean(value));
  return [...new Set(present)].sort((a, b) => a.localeCompare(b));
}

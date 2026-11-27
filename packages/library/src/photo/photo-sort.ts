import type { Photo } from "./photo";

const filenameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function sortPhotosOldestFirst(photos: Photo[]): Photo[] {
  return [...photos].sort(
    (a, b) =>
      compareNullsLast(a.filterInfo?.dateTaken ?? null, b.filterInfo?.dateTaken ?? null) ||
      compareNullsLast(a.filterInfo?.captureTime ?? null, b.filterInfo?.captureTime ?? null) ||
      filenameCollator.compare(a.filename, b.filename) ||
      a.path.localeCompare(b.path),
  );
}

function compareNullsLast(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

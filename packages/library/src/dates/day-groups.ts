import type { Photo } from "../photo/photo";
import { UNDATED_KEY } from "./date-selection";

export interface PhotoDayGroup {
  /** YYYY-MM-DD, or `null` for photos without a capture date. */
  date: string | null;
  photos: Photo[];
}

/** Groups keep the input order of their photos; days are oldest first, undated last. */
export function getDayGroups(photos: readonly Photo[]): PhotoDayGroup[] {
  const groups = new Map<string, Photo[]>();
  for (const photo of photos) {
    const key = photo.filterInfo?.dateTaken ?? UNDATED_KEY;
    const group = groups.get(key);
    if (group) group.push(photo);
    else groups.set(key, [photo]);
  }
  return [...groups.entries()]
    .map(([key, group]) => ({ date: key === UNDATED_KEY ? null : key, photos: group }))
    .sort((a, b) => {
      if (a.date === null) return 1;
      if (b.date === null) return -1;
      return a.date.localeCompare(b.date);
    });
}

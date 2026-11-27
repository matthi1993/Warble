import type { Photo } from "../photo/photo";
import { captureDay } from "./capture-day";

export const UNDATED_KEY = "undated";

/** A selection key is `null` (everything), `"undated"`, a year, a year-month or a full day. */
export function matchesDateSelection(photo: Photo, key: string | null): boolean {
  if (key === null) return true;
  const date = captureDay(photo);
  return key === UNDATED_KEY ? date === null : date?.startsWith(key) ?? false;
}

export function dateSelectionLabel(key: string | null): string {
  if (key === null) return "Days";
  if (key === UNDATED_KEY) return "Date unknown";
  if (key.length === 4) return key;
  const isMonth = key.length === 7;
  const date = new Date(`${isMonth ? `${key}-01` : key}T12:00:00`);
  return new Intl.DateTimeFormat(
    undefined,
    isMonth
      ? { month: "long", year: "numeric" }
      : { day: "numeric", month: "long", year: "numeric" },
  ).format(date);
}

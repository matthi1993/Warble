import type { Photo } from "../photo/photo";

export function captureDay(photo: Photo): string | null {
  return normalizeCaptureDay(photo.filterInfo?.dateTaken);
}

export function normalizeCaptureDay(date: string | null | undefined): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T12:00:00`);
  const isRealDate = !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  return isRealDate ? date : null;
}

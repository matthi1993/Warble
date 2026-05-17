import type { ExifMetadata } from "./types";

/** Join camera make + model only when the model doesn't already
 *  include the make (e.g. "NIKON D850" already starts with "NIKON
 *  CORPORATION", so don't double up). */
export function formatCameraName(meta: ExifMetadata): string | null {
  return joinMakeModel(meta.cameraMake, meta.cameraModel);
}

export function formatLensName(meta: ExifMetadata): string | null {
  return joinMakeModel(meta.lensMake, meta.lensModel);
}

function joinMakeModel(
  rawMake: string | null | undefined,
  rawModel: string | null | undefined,
): string | null {
  const make = (rawMake ?? "").trim();
  const model = (rawModel ?? "").trim();
  if (!make && !model) return null;
  if (!make) return model;
  if (!model) return make;
  if (model.toLowerCase().startsWith(make.toLowerCase())) return model;
  return `${make} ${model}`;
}

/** EXIF DateTimeOriginal is "YYYY:MM:DD HH:MM:SS". Normalise to
 *  a more readable "YYYY-MM-DD HH:MM" without TZ guessing. */
export function formatExifDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2})/);
  if (!m) return raw;
  const [, y, mo, d, h, mi] = m;
  return `${y}-${mo}-${d} ${h}:${mi}`;
}

export function formatGpsCoords(
  lat: number | null | undefined,
  lon: number | null | undefined,
): string | null {
  if (lat == null || lon == null) return null;
  return `${lat.toFixed(5)}°, ${lon.toFixed(5)}°`;
}

export function formatDimensions(
  w: number | null | undefined,
  h: number | null | undefined,
): string | null {
  if (!w || !h) return null;
  const mp = (w * h) / 1_000_000;
  return `${w} × ${h} (${mp.toFixed(1)} MP)`;
}

import type { ExifMetadata } from "./exif-metadata";

export function formatCameraName(meta: ExifMetadata): string | null {
  return joinMakeModel(meta.cameraMake, meta.cameraModel);
}

export function formatLensName(meta: ExifMetadata): string | null {
  return joinMakeModel(meta.lensMake, meta.lensModel);
}

/** EXIF DateTimeOriginal is "YYYY:MM:DD HH:MM:SS". */
export function formatExifDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = raw.match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2})/);
  if (!match) return raw;
  const [, year, month, day, hour, minute] = match;
  return `${year}-${month}-${day} ${hour}:${minute}`;
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
  const megapixels = (w * h) / 1_000_000;
  return `${w} × ${h} (${megapixels.toFixed(1)} MP)`;
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
  // Some cameras repeat the make inside the model, e.g. "Canon" + "Canon EOS R5".
  if (model.toLowerCase().startsWith(make.toLowerCase())) return model;
  return `${make} ${model}`;
}

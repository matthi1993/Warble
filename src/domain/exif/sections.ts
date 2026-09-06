import type { ExifMetadata } from "./types";
import {
  formatCameraName,
  formatDimensions,
  formatExifDate,
  formatGpsCoords,
  formatLensName,
} from "./formatters";

export interface ExifRow {
  label: string;
  value: string;
}

export interface ExifSection {
  title: string;
  rows: ExifRow[];
}

/** Build the grouped, presentation-ready EXIF table rows that the
 *  Info card renders. Returns only sections that have content so the
 *  consumer can render `sections.length === 0` as "no metadata". */
export function buildExifSections(meta: ExifMetadata | null): ExifSection[] {
  if (!meta) return [];
  const cameraName = formatCameraName(meta);
  const lensName = formatLensName(meta);
  const focalDisplay = meta.focalLength ?? null;
  const focal35 =
    meta.focalLength35mm && meta.focalLength35mm !== meta.focalLength
      ? meta.focalLength35mm
      : null;
  const dateTaken = formatExifDate(meta.dateTaken);
  const dimensions = formatDimensions(meta.pixelWidth, meta.pixelHeight);
  const gps = formatGpsCoords(meta.gpsLatitude, meta.gpsLongitude);

  const cameraRows: ExifRow[] = [];
  if (cameraName) cameraRows.push({ label: "Camera", value: cameraName });
  if (lensName) cameraRows.push({ label: "Lens", value: lensName });
  if (meta.cameraSerial)
    cameraRows.push({ label: "Body serial", value: meta.cameraSerial });
  if (meta.lensSerial)
    cameraRows.push({ label: "Lens serial", value: meta.lensSerial });
  if (meta.software)
    cameraRows.push({ label: "Software", value: meta.software });

  const exposureRows: ExifRow[] = [];
  if (meta.iso) exposureRows.push({ label: "ISO", value: meta.iso });
  if (meta.shutterSpeed)
    exposureRows.push({ label: "Shutter speed", value: meta.shutterSpeed });
  if (meta.aperture)
    exposureRows.push({ label: "Aperture", value: meta.aperture });
  if (focalDisplay)
    exposureRows.push({ label: "Focal length", value: focalDisplay });
  if (focal35) exposureRows.push({ label: "35mm equiv.", value: focal35 });
  if (meta.exposureCompensation)
    exposureRows.push({
      label: "Exposure comp.",
      value: meta.exposureCompensation,
    });
  if (meta.exposureMode)
    exposureRows.push({ label: "Exposure mode", value: meta.exposureMode });
  if (meta.exposureProgram)
    exposureRows.push({
      label: "Exposure program",
      value: meta.exposureProgram,
    });
  if (meta.meteringMode)
    exposureRows.push({ label: "Metering", value: meta.meteringMode });
  if (meta.whiteBalance)
    exposureRows.push({ label: "White balance", value: meta.whiteBalance });
  if (meta.flash) exposureRows.push({ label: "Flash", value: meta.flash });

  const imageRows: ExifRow[] = [];
  if (dimensions) imageRows.push({ label: "Dimensions", value: dimensions });
  if (meta.colorSpace)
    imageRows.push({ label: "Color space", value: meta.colorSpace });
  if (meta.orientation)
    imageRows.push({ label: "Orientation", value: meta.orientation });

  const captureRows: ExifRow[] = [];
  if (dateTaken) captureRows.push({ label: "Date taken", value: dateTaken });
  if (meta.artist) captureRows.push({ label: "Artist", value: meta.artist });
  if (meta.copyright)
    captureRows.push({ label: "Copyright", value: meta.copyright });
  if (gps) captureRows.push({ label: "GPS", value: gps });
  if (meta.gpsAltitude)
    captureRows.push({ label: "Altitude", value: meta.gpsAltitude });

  return [
    { title: "Camera & lens", rows: cameraRows },
    { title: "Exposure", rows: exposureRows },
    { title: "Image", rows: imageRows },
    { title: "Capture", rows: captureRows },
  ].filter((s) => s.rows.length > 0);
}

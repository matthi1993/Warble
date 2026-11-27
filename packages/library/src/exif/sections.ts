import type { ExifMetadata } from "./exif-metadata";
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

type RowCandidate = [label: string, value: string | null | undefined];

export function buildExifSections(meta: ExifMetadata | null): ExifSection[] {
  if (!meta) return [];
  const focalLength35mm =
    meta.focalLength35mm && meta.focalLength35mm !== meta.focalLength
      ? meta.focalLength35mm
      : null;

  return [
    section("Camera & lens", [
      ["Camera", formatCameraName(meta)],
      ["Lens", formatLensName(meta)],
      ["Body serial", meta.cameraSerial],
      ["Lens serial", meta.lensSerial],
      ["Software", meta.software],
    ]),
    section("Exposure", [
      ["ISO", meta.iso],
      ["Shutter speed", meta.shutterSpeed],
      ["Aperture", meta.aperture],
      ["Focal length", meta.focalLength],
      ["35mm equiv.", focalLength35mm],
      ["Exposure comp.", meta.exposureCompensation],
      ["Exposure mode", meta.exposureMode],
      ["Exposure program", meta.exposureProgram],
      ["Metering", meta.meteringMode],
      ["White balance", meta.whiteBalance],
      ["Flash", meta.flash],
    ]),
    section("Image", [
      ["Dimensions", formatDimensions(meta.pixelWidth, meta.pixelHeight)],
      ["Color space", meta.colorSpace],
      ["Orientation", meta.orientation],
    ]),
    section("Capture", [
      ["Date taken", formatExifDate(meta.dateTaken)],
      ["Artist", meta.artist],
      ["Copyright", meta.copyright],
      ["GPS", formatGpsCoords(meta.gpsLatitude, meta.gpsLongitude)],
      ["Altitude", meta.gpsAltitude],
    ]),
  ].filter((candidate) => candidate.rows.length > 0);
}

function section(title: string, candidates: RowCandidate[]): ExifSection {
  const rows = candidates.flatMap(([label, value]) => (value ? [{ label, value }] : []));
  return { title, rows };
}

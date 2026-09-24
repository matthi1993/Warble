/**
 * EXIF metadata value-object — exactly what the Rust `get_exif_metadata`
 * command returns. All fields are optional because no camera writes
 * every tag and our reader is permissive.
 */
export interface ExifMetadata {
  cameraMake?: string | null;
  cameraModel?: string | null;
  cameraSerial?: string | null;
  software?: string | null;
  lensMake?: string | null;
  lensModel?: string | null;
  lensSerial?: string | null;
  iso?: string | null;
  shutterSpeed?: string | null;
  aperture?: string | null;
  focalLength?: string | null;
  /** Numeric focal length in millimetres, for range filtering. */
  focalLengthMm?: number | null;
  focalLength35mm?: string | null;
  exposureCompensation?: string | null;
  exposureProgram?: string | null;
  exposureMode?: string | null;
  meteringMode?: string | null;
  whiteBalance?: string | null;
  flash?: string | null;
  pixelWidth?: number | null;
  pixelHeight?: number | null;
  orientation?: string | null;
  colorSpace?: string | null;
  dateTaken?: string | null;
  artist?: string | null;
  copyright?: string | null;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  gpsAltitude?: string | null;
}

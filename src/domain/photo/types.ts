/**
 * Photo domain types — the shape of an individual file on disk and
 * its sibling variants. Pure value-object definitions, no logic.
 */

export interface PhotoFile {
  /** Absolute path to the file on disk. */
  path: string;
  /** Lowercased extension (no dot). */
  extension: string;
  /** Variant key. `"base"` for the primary file, or the contents of the
   * trailing parentheses on the stem (e.g. `"1"`, `"edit"`). */
  variant: string;
}

/** EXIF fields used by the grid filter panel. Kept separate from the full
 * EXIF record so photo listings do not carry the complete info panel model. */
export interface PhotoFilterInfo {
  camera?: string | null;
  lens?: string | null;
  focalLengthMm?: number | null;
  /** Normalized EXIF capture day in YYYY-MM-DD form. */
  dateTaken?: string | null;
}

export interface Photo {
  path: string;
  filename: string;
  /**
   * All file extensions (lowercase, no dot) for files in the same folder
   * sharing this photo's stem. A JPEG with a sibling RAW will list both.
   */
  extensions?: string[];
  /** Per-file breakdown including variant labels. */
  files?: PhotoFile[];
  /** Cached EXIF projection used by grid filters. */
  filterInfo?: PhotoFilterInfo;
}

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
}

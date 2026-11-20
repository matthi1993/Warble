export interface PhotoFile {
  path: string;
  /** Lowercase, without the dot. */
  extension: string;
  /** `"base"` for the primary file, otherwise the text in the stem's trailing parentheses. */
  variant: string;
}

export interface PhotoFilterInfo {
  camera?: string | null;
  lens?: string | null;
  focalLengthMm?: number | null;
  /** YYYY-MM-DD */
  dateTaken?: string | null;
  /** YYYY-MM-DD HH:MM:SS */
  captureTime?: string | null;
}

export interface PhotoFilterMetadata extends PhotoFilterInfo {
  path: string;
}

export interface Photo {
  path: string;
  filename: string;
  /** Lowercase extensions of every file sharing this photo's stem. */
  extensions?: string[];
  files?: PhotoFile[];
  filterInfo?: PhotoFilterInfo;
}

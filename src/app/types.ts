export interface Photo {
  path: string;
  filename: string;
  /**
   * All file extensions (lowercase, no dot) for files in the same folder
   * sharing this photo's stem. A JPEG with a sibling RAW will list both.
   */
  extensions?: string[];
}

export interface Folder {
  id: string;
  path: string;
  name: string;
  children: Folder[];
}

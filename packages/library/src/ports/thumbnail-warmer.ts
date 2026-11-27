export interface ThumbnailWarmer {
  /** Starts warming thumbnails for `paths` and returns a function that stops it. */
  warm(paths: readonly string[]): () => void;
}

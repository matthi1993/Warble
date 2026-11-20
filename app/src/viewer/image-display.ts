export interface ImageDisplay {
  /** Everything derived from the previous photo's images is stale. */
  releaseImage(): void;
  redraw(): void;
  /** Fits the newly available image and draws it. */
  showImage(): void;
  /** Runs `install` to swap the shown source and keeps the image at its on-screen size. */
  upgradeSource(install: () => void): void;
  warmup(): void;
}

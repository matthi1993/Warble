/** The frozen picture of the previous slide that covers the stage while the next one loads. */
export interface SlideOverlay {
  capture(): void;
  hide(): void;
  fadeOut(stillWanted: () => boolean): void;
}

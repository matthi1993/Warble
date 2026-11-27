export type VideoPresentationEvent = "video-playing" | "video-ended" | "video-error" | "video-activate";
export type VideoInteractionEvent = "video-activate" | "video-double-activate" | "video-swipe";

export interface VideoEventSource extends EventTarget {
  readonly path: string | null;
}

export class VideoViewEvents {
  constructor(private readonly source: VideoEventSource) {}

  /** For the slideshow: carries the path and stays on the element. */
  presentation(type: VideoPresentationEvent): void {
    this.source.dispatchEvent(new CustomEvent(type, { detail: { path: this.source.path } }));
  }

  interaction(type: VideoInteractionEvent, delta?: number): void {
    this.source.dispatchEvent(
      new CustomEvent(type, {
        detail: delta === undefined ? undefined : { delta },
        bubbles: true,
        composed: true,
        cancelable: type === "video-double-activate",
      }),
    );
  }
}

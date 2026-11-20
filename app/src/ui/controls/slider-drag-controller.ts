export interface SliderDragHost {
  readonly ownerDocument: Document;
  dispatchEvent(event: Event): boolean;
}

export type SliderPointer = Pick<PointerEvent, "button" | "pointerId">;

/**
 * Announces the start and the end of one slider drag. The native range input keeps its own
 * pointer capture, so the release is watched on the document, where it also arrives when the
 * pointer is let go outside the slider.
 */
export class SliderDragController {
  private activePointer: number | null = null;
  private watchedDocument: Document | null = null;

  constructor(private readonly host: SliderDragHost) {}

  get dragging(): boolean {
    return this.activePointer !== null;
  }

  begin = (pointer: SliderPointer): void => {
    if (pointer.button !== 0 || this.activePointer !== null) return;
    this.activePointer = pointer.pointerId;
    this.watchedDocument = this.host.ownerDocument;
    this.watchedDocument.addEventListener("pointerup", this.onPointerEnd, true);
    this.watchedDocument.addEventListener("pointercancel", this.onPointerEnd, true);
    this.watchedDocument.defaultView?.addEventListener("blur", this.finish);
    this.announce("slider-interaction-start");
  };

  finish = (): void => {
    if (this.activePointer === null) return;
    this.activePointer = null;
    this.watchedDocument?.removeEventListener("pointerup", this.onPointerEnd, true);
    this.watchedDocument?.removeEventListener("pointercancel", this.onPointerEnd, true);
    this.watchedDocument?.defaultView?.removeEventListener("blur", this.finish);
    this.watchedDocument = null;
    this.announce("slider-interaction-end");
  };

  private onPointerEnd = (event: Event): void => {
    if ((event as PointerEvent).pointerId === this.activePointer) this.finish();
  };

  private announce(type: "slider-interaction-start" | "slider-interaction-end"): void {
    this.host.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true }));
  }
}

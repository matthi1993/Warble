import type { TapGestures } from "./tap-gestures";
import type { ViewerScene } from "./viewer-scene";

const HOLD_MS = 500;
const CLICK_SUPPRESSION_MS = 600;

export interface LongPressHost {
  dispatchEvent(event: Event): boolean;
}

export class LongPress {
  /** The current gesture became a long press, so it must not also count as a tap. */
  consumed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pointerId: number | null = null;
  private active = false;

  constructor(
    private readonly host: LongPressHost,
    private readonly scene: ViewerScene,
    private readonly taps: TapGestures,
  ) {}

  tracks(pointerId: number): boolean {
    return this.pointerId === pointerId;
  }

  start(event: PointerEvent): void {
    if (!this.scene.isOverImage(event.clientX, event.clientY)) return;
    this.taps.cancelActivation();
    this.pointerId = event.pointerId;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.active = true;
      this.consumed = true;
      this.taps.cancelActivation();
      this.taps.forgetTap();
      this.announce("image-preview-start");
    }, HOLD_MS);
  }

  /** Ends the press of `pointerId`, or any press when omitted. Returns whether a preview was showing. */
  end(pointerId?: number): boolean {
    if (pointerId !== undefined && this.pointerId !== pointerId) return false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pointerId = null;
    if (!this.active) return false;
    this.active = false;
    this.taps.suppressClicks(CLICK_SUPPRESSION_MS);
    this.announce("image-preview-end");
    return true;
  }

  private announce(type: "image-preview-start" | "image-preview-end"): void {
    this.host.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true }));
  }
}

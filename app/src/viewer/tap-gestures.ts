import type { ViewerScene } from "./viewer-scene";
import type { ViewerSettings } from "./viewer-settings";
import type { Point } from "./viewer-surface";

const ACTIVATION_DELAY_MS = 280;
const TOUCH_CLICK_SUPPRESSION_MS = 600;
const SWIPE_MAX_MS = 650;
const SWIPE_MIN_DISTANCE = 56;
const SWIPE_MIN_SLOPE = 1.35;
const TAP_MAX_MS = 450;
const TAP_MAX_MOVEMENT = 10;
const DOUBLE_TAP_MAX_MS = 340;
const DOUBLE_TAP_MAX_DISTANCE = 28;

export interface TouchStart extends Point {
  time: number;
}

export interface TapGesturesHost extends Pick<ViewerSettings, "presenting" | "cropMode"> {
  dispatchEvent(event: Event): boolean;
}

export class TapGestures {
  private activationTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTap: TouchStart | null = null;
  /** The webview sends a mouse click after a touch; that duplicate is ignored. */
  private clicksSuppressedUntil = 0;

  constructor(
    private readonly host: TapGesturesHost,
    private readonly scene: ViewerScene,
  ) {}

  readonly onClick = (): void => {
    if (performance.now() < this.clicksSuppressedUntil) return;
    this.scheduleActivation();
  };

  readonly onDoubleClick = (event: MouseEvent): void => {
    if (performance.now() < this.clicksSuppressedUntil || this.host.cropMode) {
      event.preventDefault();
      return;
    }
    if (!this.scene.hasImage || !this.scene.surface.attached) return;
    event.preventDefault();
    this.cancelActivation();
    this.doubleActivate(event.clientX, event.clientY);
  };

  suppressClicks(milliseconds: number): void {
    this.clicksSuppressedUntil = performance.now() + milliseconds;
  }

  forgetTap(): void {
    this.lastTap = null;
  }

  cancelActivation(): void {
    if (this.activationTimer === null) return;
    clearTimeout(this.activationTimer);
    this.activationTimer = null;
  }

  finishTouch(event: PointerEvent, start: TouchStart | null, pinched: boolean): void {
    this.suppressClicks(TOUCH_CLICK_SUPPRESSION_MS);
    if (!start || pinched || event.type === "pointercancel") return;
    const elapsed = performance.now() - start.time;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (this.isSwipe(elapsed, dx, dy)) {
      this.swipe(dx < 0 ? 1 : -1);
      return;
    }
    if (Math.hypot(dx, dy) > TAP_MAX_MOVEMENT || elapsed > TAP_MAX_MS) return;
    const now = performance.now();
    const previous = this.lastTap;
    const doubleTap =
      previous &&
      now - previous.time <= DOUBLE_TAP_MAX_MS &&
      Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= DOUBLE_TAP_MAX_DISTANCE;
    if (doubleTap) {
      this.lastTap = null;
      this.cancelActivation();
      this.doubleActivate(event.clientX, event.clientY);
      return;
    }
    this.lastTap = { x: event.clientX, y: event.clientY, time: now };
    this.scheduleActivation();
  }

  /** A zoomed-in image pans with one finger; only a fitted one navigates. */
  private isSwipe(elapsed: number, dx: number, dy: number): boolean {
    const fitted = this.host.presenting || this.scene.viewport.isFitting;
    return (
      fitted &&
      elapsed <= SWIPE_MAX_MS &&
      Math.abs(dx) >= SWIPE_MIN_DISTANCE &&
      Math.abs(dx) > Math.abs(dy) * SWIPE_MIN_SLOPE
    );
  }

  private swipe(delta: 1 | -1): void {
    const { viewport } = this.scene;
    this.lastTap = null;
    this.cancelActivation();
    viewport.userInteracted = false;
    viewport.offsetX = 0;
    viewport.offsetY = 0;
    this.host.dispatchEvent(
      new CustomEvent("image-swipe", { detail: { delta }, bubbles: true, composed: true }),
    );
  }

  private scheduleActivation(): void {
    this.cancelActivation();
    this.activationTimer = setTimeout(() => {
      this.activationTimer = null;
      this.host.dispatchEvent(new CustomEvent("image-activate", { bubbles: true, composed: true }));
    }, ACTIVATION_DELAY_MS);
  }

  /** Unless a listener claims the gesture, toggles between fit and one image pixel per CSS pixel. */
  private doubleActivate(clientX: number, clientY: number): void {
    const claimed = !this.host.dispatchEvent(
      new CustomEvent("image-double-activate", { bubbles: true, composed: true, cancelable: true }),
    );
    const { scene } = this;
    if (claimed || !scene.hasImage || !scene.surface.attached) return;
    if (scene.viewport.isFitting) {
      const point = scene.surface.point(clientX, clientY);
      scene.viewport.zoomAround(point.x, point.y, scene.surface.pixelRatio, scene.bounds());
      scene.viewport.userInteracted = true;
    } else {
      scene.viewport.snapToFit();
    }
    scene.redraw();
  }
}

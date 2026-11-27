import type { VideoViewEvents } from "./video-view-events";

const SWIPE_MAX_DURATION_MS = 650;
const SWIPE_MIN_DISTANCE = 56;
const SWIPE_MIN_HORIZONTAL_RATIO = 1.35;
const TAP_MAX_MOVEMENT = 10;
const TAP_MAX_DURATION_MS = 450;
const DOUBLE_TAP_MAX_INTERVAL_MS = 340;
const DOUBLE_TAP_MAX_DISTANCE = 28;
const SINGLE_TAP_DELAY_MS = 280;
/** A touch is followed by a synthetic click, which would count the same tap twice. */
const CLICK_AFTER_TOUCH_MS = 600;

interface TouchPoint {
  x: number;
  y: number;
  time: number;
}

export class VideoGestureController {
  private touchStart: TouchPoint | null = null;
  private lastTap: TouchPoint | null = null;
  private activationTimer: ReturnType<typeof setTimeout> | null = null;
  private suppressClickUntil = 0;

  constructor(
    private readonly view: { readonly presenting: boolean },
    private readonly events: VideoViewEvents,
  ) {}

  clicked(event: MouseEvent): void {
    event.stopPropagation();
    if (performance.now() < this.suppressClickUntil) return;
    if (this.view.presenting) this.events.presentation("video-activate");
    else this.events.interaction("video-activate");
  }

  doubleClicked(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.view.presenting) return;
    this.cancelPendingActivation();
    this.events.interaction("video-double-activate");
  }

  pointerDown(event: PointerEvent): void {
    if (event.pointerType !== "touch" || !event.isPrimary) return;
    this.touchStart = { x: event.clientX, y: event.clientY, time: performance.now() };
  }

  pointerUp(event: PointerEvent): void {
    if (event.pointerType !== "touch" || !event.isPrimary) return;
    const start = this.touchStart;
    this.touchStart = null;
    this.suppressClickUntil = performance.now() + CLICK_AFTER_TOUCH_MS;
    if (!start || event.type === "pointercancel") return;

    const elapsed = performance.now() - start.time;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const horizontal = Math.abs(dx) >= SWIPE_MIN_DISTANCE && Math.abs(dx) > Math.abs(dy) * SWIPE_MIN_HORIZONTAL_RATIO;
    if (elapsed <= SWIPE_MAX_DURATION_MS && horizontal) {
      this.forgetTaps();
      this.events.interaction("video-swipe", dx < 0 ? 1 : -1);
      return;
    }
    if (Math.hypot(dx, dy) > TAP_MAX_MOVEMENT || elapsed > TAP_MAX_DURATION_MS) return;
    if (this.view.presenting) {
      this.forgetTaps();
      this.events.presentation("video-activate");
      return;
    }
    this.tapped({ x: event.clientX, y: event.clientY, time: performance.now() });
  }

  cancelPendingActivation(): void {
    if (this.activationTimer === null) return;
    clearTimeout(this.activationTimer);
    this.activationTimer = null;
  }

  /** A single tap waits briefly so that a second tap can turn it into a double tap. */
  private tapped(tap: TouchPoint): void {
    const previous = this.lastTap;
    const doubleTap =
      previous !== null &&
      tap.time - previous.time <= DOUBLE_TAP_MAX_INTERVAL_MS &&
      Math.hypot(tap.x - previous.x, tap.y - previous.y) <= DOUBLE_TAP_MAX_DISTANCE;
    if (doubleTap) {
      this.forgetTaps();
      this.events.interaction("video-double-activate");
      return;
    }
    this.lastTap = tap;
    this.cancelPendingActivation();
    this.activationTimer = setTimeout(() => {
      this.activationTimer = null;
      this.events.interaction("video-activate");
    }, SINGLE_TAP_DELAY_MS);
  }

  private forgetTaps(): void {
    this.lastTap = null;
    this.cancelPendingActivation();
  }
}

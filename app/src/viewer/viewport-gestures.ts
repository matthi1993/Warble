import type { LongPress } from "./long-press";
import { PinchGesture } from "./pinch-gesture";
import type { TapGestures, TouchStart } from "./tap-gestures";
import type { ViewerScene } from "./viewer-scene";
import type { Point } from "./viewer-surface";

const WHEEL_ZOOM_RATE = 0.0015;
const LONG_PRESS_MAX_MOVEMENT = 10;
const CLICK_MAX_MOVEMENT = 5;
const DRAG_CLICK_SUPPRESSION_MS = 100;

export class ViewportGestures {
  private readonly touches = new Map<number, Point>();
  private touchStart: TouchStart | null = null;
  private touchPinched = false;
  private pinch: PinchGesture | null = null;
  private dragging = false;
  private dragMoved = false;
  private dragStart = { x: 0, y: 0, offsetX: 0, offsetY: 0 };

  constructor(
    private readonly scene: ViewerScene,
    private readonly taps: TapGestures,
    private readonly longPress: LongPress,
  ) {}

  readonly onWheel = (event: WheelEvent): void => {
    const { viewport, surface, quality } = this.scene;
    if (!this.scene.hasImage || !surface.attached) return;
    event.preventDefault();
    const point = surface.point(event.clientX, event.clientY);
    const zoomed = viewport.scale * Math.exp(-event.deltaY * WHEEL_ZOOM_RATE);
    const scale = Math.min(viewport.maxScale(surface.pixelRatio), Math.max(viewport.minScale, zoomed));
    if (scale === viewport.scale) {
      quality.viewportSettled();
      return;
    }
    viewport.zoomAround(point.x, point.y, scale, this.scene.bounds());
    this.viewportChanged();
    viewport.userInteracted = true;
    this.scene.requestRedraw();
  };

  begin(event: PointerEvent): void {
    const canvas = this.scene.surface.canvas;
    if (this.touches.size === 0) this.longPress.consumed = false;
    if (event.pointerType === "touch") {
      this.beginTouch(event);
    } else {
      this.dragMoved = false;
      this.beginPan(event.clientX, event.clientY);
      this.longPress.start(event);
      canvas.setPointerCapture(event.pointerId);
    }
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onEnd);
    canvas.addEventListener("pointercancel", this.onEnd);
  }

  private beginTouch(event: PointerEvent): void {
    event.preventDefault();
    if (this.touches.size === 0) {
      this.touchStart = { x: event.clientX, y: event.clientY, time: performance.now() };
      this.touchPinched = false;
    }
    this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.capture(event.pointerId, true);
    if (this.touches.size >= 2) {
      this.longPress.end();
      this.beginPinch();
    } else {
      this.beginPan(event.clientX, event.clientY);
      this.longPress.start(event);
    }
  }

  private beginPan(clientX: number, clientY: number): void {
    const { viewport, surface } = this.scene;
    this.dragging = true;
    this.dragStart = { x: clientX, y: clientY, offsetX: viewport.offsetX, offsetY: viewport.offsetY };
    surface.canvas.classList.add("dragging");
  }

  private beginPinch(): void {
    const [first, second] = this.touches.values();
    this.pinch = new PinchGesture(this.scene, first, second);
    this.touchPinched = true;
    this.dragging = false;
    this.scene.surface.canvas.classList.remove("dragging");
  }

  private readonly onMove = (event: PointerEvent): void => {
    const fromStart = Math.hypot(event.clientX - this.dragStart.x, event.clientY - this.dragStart.y);
    if (this.longPress.tracks(event.pointerId) && fromStart > LONG_PRESS_MAX_MOVEMENT) {
      this.longPress.end(event.pointerId);
    }
    if (event.pointerType === "touch" && this.touches.has(event.pointerId)) {
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.touches.size >= 2 && this.pinch) {
        event.preventDefault();
        const [first, second] = this.touches.values();
        this.viewportMoved(this.pinch.moveTo(first, second));
        return;
      }
    }
    if (!this.dragging) return;
    if (fromStart > CLICK_MAX_MOVEMENT) this.dragMoved = true;
    const { viewport, surface } = this.scene;
    const moved = viewport.place(
      viewport.scale,
      this.dragStart.offsetX + (event.clientX - this.dragStart.x) * surface.pixelRatio,
      this.dragStart.offsetY + (event.clientY - this.dragStart.y) * surface.pixelRatio,
      this.scene.bounds(),
    );
    if (moved) viewport.userInteracted = true;
    this.viewportMoved(moved);
  };

  private readonly onEnd = (event: PointerEvent): void => {
    this.longPress.end(event.pointerId);
    if (event.pointerType === "touch") {
      this.endTouch(event);
      return;
    }
    if (this.dragMoved) this.taps.suppressClicks(DRAG_CLICK_SUPPRESSION_MS);
    this.endGesture(event.pointerId);
    this.longPress.consumed = false;
  };

  private endTouch(event: PointerEvent): void {
    if (!this.touches.delete(event.pointerId)) return;
    this.capture(event.pointerId, false);
    if (this.touches.size >= 2) {
      this.beginPinch();
      return;
    }
    this.pinch = null;
    if (this.touches.size === 1) {
      const [remaining] = this.touches.values();
      this.beginPan(remaining.x, remaining.y);
      return;
    }
    this.endGesture();
    const start = this.touchStart;
    this.touchStart = null;
    if (this.longPress.consumed) {
      this.taps.forgetTap();
      this.longPress.consumed = false;
    } else {
      this.taps.finishTouch(event, start, this.touchPinched);
    }
  }

  private endGesture(capturedPointerId?: number): void {
    const canvas = this.scene.surface.canvas;
    this.dragging = false;
    this.scene.quality.viewportSettled();
    canvas.classList.remove("dragging");
    if (capturedPointerId !== undefined) this.capture(capturedPointerId, false);
    canvas.removeEventListener("pointermove", this.onMove);
    canvas.removeEventListener("pointerup", this.onEnd);
    canvas.removeEventListener("pointercancel", this.onEnd);
  }

  /** A viewport that did not move ends any reduced-quality preview at once. */
  private viewportMoved(moved: boolean): void {
    if (!moved) {
      this.scene.quality.viewportSettled();
      return;
    }
    this.viewportChanged();
    this.scene.requestRedraw();
  }

  private viewportChanged(): void {
    this.scene.quality.viewportChanged(this.dragging || this.pinch !== null);
  }

  private capture(pointerId: number, captured: boolean): void {
    const canvas = this.scene.surface.canvas;
    try {
      if (captured) canvas.setPointerCapture(pointerId);
      else canvas.releasePointerCapture(pointerId);
    } catch {
      // Best-effort: the pointer may already be gone.
    }
  }
}

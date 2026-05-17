/**
 * Cursor-idle controller. Tracks mouse movement over the canvas
 * area and flips an `idle` flag after a quiet period so the host
 * can auto-hide chrome in fullscreen.
 *
 * The "canvas area" definition (49 px from top/bottom, 260 px gutter
 * on the left, optional 312 / 80 px gutter on the right) is owned
 * here so the host doesn't need to keep two cursor-zone definitions
 * in sync.
 */

export interface IdleControllerOptions {
  /** Read live: is the host in fullscreen mode? */
  isFullscreen(): boolean;
  /** Read live: are edit affordances on (right-side panel allowed)? */
  isEditMode(): boolean;
  /** Read live: is the edit panel currently visible in fullscreen? */
  isEditPanelVisible(): boolean;
  /** Called when the idle state should change. */
  onIdleChange(idle: boolean): void;
}

const IDLE_TIMEOUT_MS = 1000;

export class IdleController {
  private idle = false;
  private timer: number | null = null;
  constructor(private readonly opts: IdleControllerOptions) {}

  /** Process a mousemove. Returns whether the cursor is currently
   *  inside the canvas area (host can use this to gate other
   *  reveal behaviour). */
  onMouseMove(x: number, y: number): boolean {
    if (!this.opts.isFullscreen()) return false;
    const onCanvas = this.cursorOnCanvasArea(x, y);
    if (!onCanvas) {
      this.clearTimer();
      this.setIdle(false);
      return false;
    }
    if (this.idle) return true;
    this.clearTimer();
    this.timer = window.setTimeout(() => {
      this.setIdle(true);
    }, IDLE_TIMEOUT_MS);
    return true;
  }

  /** Called when fullscreen toggles on so the timer restarts cleanly. */
  bump(): void {
    this.setIdle(false);
    this.clearTimer();
    if (!this.opts.isFullscreen()) return;
    this.timer = window.setTimeout(() => {
      this.setIdle(true);
    }, IDLE_TIMEOUT_MS);
  }

  /** Called when fullscreen toggles off. */
  reset(): void {
    this.clearTimer();
    this.setIdle(false);
  }

  dispose(): void {
    this.clearTimer();
  }

  private setIdle(v: boolean) {
    if (this.idle === v) return;
    this.idle = v;
    this.opts.onIdleChange(v);
  }

  private clearTimer() {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** True when the cursor sits over the image canvas area (i.e. not
   *  over the toolbar, bottombar, or the floating edit panel). */
  cursorOnCanvasArea(x: number, y: number): boolean {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (y < 49) return false;
    if (y > h - 49) return false;
    if (this.opts.isEditMode()) {
      const rightZone = this.opts.isEditPanelVisible() ? 32 + 280 : 80;
      if (x > w - rightZone) return false;
    }
    if (x < 260) return false;
    return true;
  }
}

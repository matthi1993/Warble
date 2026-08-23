/**
 * Cursor-idle controller for fullscreen mode.
 *
 * In fullscreen, all chrome (toolbar, bottombar, nav, edit panel,
 * hint) floats over the image as overlays. They are visible by
 * default and fade out after the cursor stays still over the image
 * for a short period. Moving the cursor near any screen edge
 * instantly cancels idle so the corresponding chrome reappears.
 *
 * Edge reveal zones:
 *   - Top edge    (y < 60 px)    → toolbar
 *   - Bottom edge (y > h - 60)   → bottombar + nav
 *   - Left edge   (x < 60 px)    → nav (prev button)
 *   - Right edge  (x > w - 60)   → edit rail/panel
 *
 * The controller also cancels idle whenever the cursor is directly
 * over a chrome element (handled by the host via `cancelIdle()`).
 */
export interface IdleControllerOptions {
  isFullscreen(): boolean;
  onIdleChange(idle: boolean): void;
}

const IDLE_TIMEOUT_MS = 1500;
const EDGE_THRESHOLD = 60;

export class IdleController {
  private idle = false;
  private timer: number | null = null;

  constructor(private readonly opts: IdleControllerOptions) {}

  /** Process a mousemove. If the cursor is near an edge, idle is
   *  cancelled immediately. Otherwise a timer is (re)started that
   *  will flip to idle after {@link IDLE_TIMEOUT_MS}. */
  onMouseMove(x: number, y: number): void {
    if (!this.opts.isFullscreen()) return;
    if (this.nearEdge(x, y)) {
      this.cancelIdle();
      return;
    }
    if (this.idle) {
      this.setIdle(false);
    }
    this.clearTimer();
    this.timer = window.setTimeout(() => {
      this.setIdle(true);
    }, IDLE_TIMEOUT_MS);
  }

  /** Cancel idle immediately — called when the cursor enters a
   *  chrome element (toolbar, bottombar, edit panel, etc.). */
  cancelIdle(): void {
    this.clearTimer();
    this.setIdle(false);
  }

  /** Called when fullscreen toggles on. */
  bump(): void {
    this.setIdle(false);
    this.clearTimer();
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

  private nearEdge(x: number, y: number): boolean {
    const w = window.innerWidth;
    const h = window.innerHeight;
    return (
      y < EDGE_THRESHOLD ||
      y > h - EDGE_THRESHOLD ||
      x < EDGE_THRESHOLD ||
      x > w - EDGE_THRESHOLD
    );
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
}

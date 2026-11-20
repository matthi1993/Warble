export const INTERACTION_RENDER_SCALE = 0.6;
const SETTLE_MS = 120;

type Timer = ReturnType<typeof setTimeout>;

/** Reduced resolution while an edit or the viewport is changing, full resolution once it settles. */
export class RenderQuality {
  private editing = false;
  private editGestureActive = false;
  private editTimer: Timer | null = null;
  private viewportMoving = false;
  private viewportTimer: Timer | null = null;

  constructor(private readonly onChange: () => void) {}

  get scale(): number {
    return this.reduced ? INTERACTION_RENDER_SCALE : 1;
  }

  get reduced(): boolean {
    return this.editing || this.viewportMoving;
  }

  beginEdit(): void {
    this.editGestureActive = true;
    this.clearEditTimer();
  }

  endEdit(): void {
    this.editGestureActive = false;
    this.clearEditTimer();
    this.setEditing(false);
  }

  editChanged(): void {
    this.setEditing(true);
    this.clearEditTimer();
    if (this.editGestureActive) return;
    this.editTimer = setTimeout(() => {
      this.editTimer = null;
      this.setEditing(false);
    }, SETTLE_MS);
  }

  /** While a pointer gesture is active the caller ends the interaction with `viewportSettled`. */
  viewportChanged(gestureActive: boolean): void {
    this.viewportMoving = true;
    this.clearViewportTimer();
    if (gestureActive) return;
    this.viewportTimer = setTimeout(() => {
      this.viewportTimer = null;
      this.viewportSettled();
    }, SETTLE_MS);
  }

  viewportSettled(): void {
    this.clearViewportTimer();
    if (!this.viewportMoving) return;
    this.viewportMoving = false;
    this.onChange();
  }

  /** Back to full quality without notifying, for when the image itself is replaced. */
  reset(): void {
    this.clearEditTimer();
    this.clearViewportTimer();
    this.editGestureActive = false;
    this.viewportMoving = false;
    this.editing = false;
  }

  private setEditing(editing: boolean): void {
    if (this.editing === editing) return;
    this.editing = editing;
    this.onChange();
  }

  private clearEditTimer(): void {
    if (this.editTimer === null) return;
    clearTimeout(this.editTimer);
    this.editTimer = null;
  }

  private clearViewportTimer(): void {
    if (this.viewportTimer === null) return;
    clearTimeout(this.viewportTimer);
    this.viewportTimer = null;
  }
}

const TOUCH_DRAG_HOLD_MS = 420;
const PEN_MENU_HOLD_MS = 550;
const SUPPRESSION_MS = 700;
const DOUBLE_TAP_MS = 350;
const MOUSE_DRAG_DISTANCE_PX = 6;
const TOUCH_SCROLL_DISTANCE_PX = 10;

export interface CardGestureHost {
  readonly path: string;
  readonly filename: string;
  dispatchEvent(event: Event): boolean;
}

/**
 * Turns pointer input on a thumbnail card into selecting, opening, the context
 * menu and the start of a photo drag. A mouse drags after a short move, a touch
 * after holding still; taps and vertical scrolling keep their normal behaviour.
 */
export class CardGestureController {
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressStart: { x: number; y: number } | null = null;
  private touchDragging = false;
  private suppressClickUntil = 0;
  private suppressContextMenuUntil = 0;
  private lastPointerType = "mouse";
  private lastTouchTap = 0;

  constructor(private readonly host: CardGestureHost) {}

  onPointerDown(event: PointerEvent): void {
    this.lastPointerType = event.pointerType;
    if (event.button !== 0 || !event.isPrimary || this.isOnRatingOverlay(event)) return;
    this.cancelLongPress();
    this.longPressStart = { x: event.clientX, y: event.clientY };
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // WebKit does not always grant pointer capture; the gesture works without it.
    }
    if (event.pointerType === "mouse") return;
    if (event.pointerType === "touch") {
      this.longPressTimer = setTimeout(() => {
        this.startPointerDrag(event);
        this.touchDragging = true;
      }, TOUCH_DRAG_HOLD_MS);
      return;
    }
    this.longPressTimer = setTimeout(() => {
      this.longPressTimer = null;
      this.longPressStart = null;
      this.suppressClicksAndMenus();
      this.openContextMenu(event.clientX, event.clientY, true);
    }, PEN_MENU_HOLD_MS);
  }

  onPointerMove(event: PointerEvent): void {
    const start = this.longPressStart;
    if (!start) return;
    const mouse = event.pointerType === "mouse";
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (moved <= (mouse ? MOUSE_DRAG_DISTANCE_PX : TOUCH_SCROLL_DISTANCE_PX)) return;
    if (mouse) this.startPointerDrag(event);
    else this.cancelLongPress();
  }

  onPointerUp(event: PointerEvent): void {
    if (this.lastPointerType === "touch" && this.longPressStart) {
      event.preventDefault();
      this.onClick(event);
    }
    if (this.touchDragging || this.suppressClickUntil > Date.now()) this.suppressClicksAndMenus();
    this.cancelLongPress();
  }

  onTouchMove(event: TouchEvent): void {
    if (this.touchDragging && event.cancelable) event.preventDefault();
  }

  /** Touch taps arrive through `onPointerUp`; the click the browser synthesizes afterwards is ignored. */
  onClick(event: MouseEvent): void {
    if (Date.now() < this.suppressClickUntil) return;
    const touch = this.lastPointerType === "touch";
    if (event.type === "click" && touch) return;
    if (touch) {
      const now = performance.now();
      if (this.lastTouchTap && now - this.lastTouchTap < DOUBLE_TAP_MS) {
        this.lastTouchTap = 0;
        this.onDblClick(event);
        return;
      }
      this.lastTouchTap = now;
    }
    this.dispatch("photo-selected", {
      path: this.host.path,
      filename: this.host.filename,
      shiftKey: event.shiftKey,
      toggle: event.metaKey || event.ctrlKey,
      touch,
    });
  }

  onDblClick(event: MouseEvent): void {
    event.preventDefault();
    if (event.type === "dblclick" && this.lastPointerType === "touch") return;
    if (Date.now() < this.suppressClickUntil) return;
    this.dispatch("photo-open", { path: this.host.path, filename: this.host.filename });
  }

  onContextMenu(event: MouseEvent): void {
    event.preventDefault();
    if (this.lastPointerType === "touch" && (this.longPressStart || this.touchDragging)) return;
    const touchContext = this.longPressStart !== null;
    this.cancelLongPress();
    if (Date.now() < this.suppressContextMenuUntil) return;
    if (touchContext) this.suppressClickUntil = Date.now() + SUPPRESSION_MS;
    this.openContextMenu(event.clientX, event.clientY, touchContext);
  }

  cancelLongPress(): void {
    if (this.longPressTimer !== null) clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
    this.longPressStart = null;
    this.touchDragging = false;
  }

  private isOnRatingOverlay(event: PointerEvent): boolean {
    return (event.target as Element).closest("pf-rating-overlay") !== null;
  }

  private startPointerDrag(event: PointerEvent): void {
    this.lastTouchTap = 0;
    this.suppressClicksAndMenus();
    this.cancelLongPress();
    this.dispatch("photo-pointer-drag-start", {
      path: this.host.path,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    });
  }

  private openContextMenu(x: number, y: number, longPress = false): void {
    this.dispatch("photo-context-menu", {
      path: this.host.path,
      filename: this.host.filename,
      x,
      y,
      longPress,
    });
  }

  private suppressClicksAndMenus(): void {
    this.suppressClickUntil = Date.now() + SUPPRESSION_MS;
    this.suppressContextMenuUntil = Date.now() + SUPPRESSION_MS;
  }

  private dispatch(type: string, detail: unknown): void {
    this.host.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
}

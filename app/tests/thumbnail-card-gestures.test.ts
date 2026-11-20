import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CardGestureController } from "../src/views/grid/card-gesture-controller";

const HOLD_MS = 420;
const SUPPRESSION_MS = 700;

function gestureHarness() {
  const events: CustomEvent[] = [];
  const host = {
    path: "photo.jpg",
    filename: "photo.jpg",
    dispatchEvent: (event: Event) => events.push(event as CustomEvent) > 0,
  };
  return {
    gestures: new CardGestureController(host),
    events,
    types: () => events.map((event) => event.type),
  };
}

function pointer(overrides: Partial<Record<"pointerType" | "clientX" | "clientY" | "button", unknown>> = {}) {
  return {
    pointerType: "touch",
    button: 0,
    isPrimary: true,
    pointerId: 1,
    clientX: 100,
    clientY: 100,
    target: { closest: () => null },
    currentTarget: { setPointerCapture() {} },
    preventDefault() {},
    ...overrides,
  } as unknown as PointerEvent;
}

function touchMove() {
  const move = { cancelable: true, prevented: false, preventDefault: () => { move.prevented = true; } };
  return move;
}

describe("CardGestureController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("touch hold starts photo dragging while taps and scrolling keep their normal behavior", () => {
    const { gestures, events, types } = gestureHarness();

    gestures.onPointerDown(pointer());
    gestures.onPointerUp(pointer());
    expect(types()).toEqual(["photo-selected"]);
    expect(events[0].detail).toMatchObject({ path: "photo.jpg", touch: true });
    expect(vi.getTimerCount()).toBe(0);

    events.length = 0;
    gestures.onPointerDown(pointer());
    gestures.onPointerMove(pointer({ clientY: 130 }));
    expect(vi.getTimerCount()).toBe(0);
    expect(events).toHaveLength(0);

    gestures.onPointerDown(pointer());
    vi.advanceTimersByTime(HOLD_MS);
    expect(types()).toEqual(["photo-pointer-drag-start"]);
    expect(events[0].detail).toEqual({ path: "photo.jpg", pointerId: 1, x: 100, y: 100 });
    const whileDragging = touchMove();
    gestures.onTouchMove(whileDragging as unknown as TouchEvent);
    expect(whileDragging.prevented).toBe(true);

    vi.advanceTimersByTime(SUPPRESSION_MS + 1);
    gestures.onContextMenu(pointer());
    gestures.onPointerUp(pointer());
    gestures.onClick({ type: "click" } as MouseEvent);
    expect(types()).toEqual(["photo-pointer-drag-start"]);
    const afterDrag = touchMove();
    gestures.onTouchMove(afterDrag as unknown as TouchEvent);
    expect(afterDrag.prevented).toBe(false);

    gestures.onPointerDown(pointer());
    gestures.cancelLongPress();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a mouse starts dragging after a short move and opens the context menu on right click", () => {
    const { gestures, events, types } = gestureHarness();

    gestures.onPointerDown(pointer({ pointerType: "mouse" }));
    expect(vi.getTimerCount()).toBe(0);
    gestures.onPointerMove(pointer({ pointerType: "mouse", clientX: 104 }));
    expect(events).toHaveLength(0);
    gestures.onPointerMove(pointer({ pointerType: "mouse", clientX: 110 }));
    expect(types()).toEqual(["photo-pointer-drag-start"]);
    gestures.onPointerUp(pointer({ pointerType: "mouse" }));
    gestures.onClick({ type: "click" } as MouseEvent);
    expect(types()).toEqual(["photo-pointer-drag-start"]);

    events.length = 0;
    vi.advanceTimersByTime(SUPPRESSION_MS + 1);
    gestures.onContextMenu(pointer({ pointerType: "mouse", clientX: 12, clientY: 34 }));
    expect(events[0].type).toBe("photo-context-menu");
    expect(events[0].detail).toEqual({ path: "photo.jpg", filename: "photo.jpg", x: 12, y: 34, longPress: false });
  });

  it("selects with modifier keys on click and opens on a double tap", () => {
    const { gestures, events, types } = gestureHarness();

    gestures.onPointerDown(pointer({ pointerType: "mouse" }));
    gestures.onPointerUp(pointer({ pointerType: "mouse" }));
    gestures.onClick({ type: "click", shiftKey: true, metaKey: false, ctrlKey: true } as MouseEvent);
    expect(events[0].detail).toEqual({
      path: "photo.jpg",
      filename: "photo.jpg",
      shiftKey: true,
      toggle: true,
      touch: false,
    });

    events.length = 0;
    vi.advanceTimersByTime(1000);
    gestures.onPointerDown(pointer());
    gestures.onPointerUp(pointer());
    vi.advanceTimersByTime(100);
    gestures.onPointerDown(pointer());
    gestures.onPointerUp(pointer());
    expect(types()).toEqual(["photo-selected", "photo-open"]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { editedViewport } from "./support/edited-viewport";
import { installBrowser, uninstallBrowser } from "./support/viewer-harness";

const touch = (pointerId: number, clientX: number, clientY: number) => ({
  pointerType: "touch",
  pointerId,
  clientX,
  clientY,
});

describe("viewer taps, swipes and long presses", () => {
  beforeEach(() => void installBrowser());
  afterEach(uninstallBrowser);

  it("a click activates after a short delay unless a double click follows", () => {
    const { canvas, host } = editedViewport();
    canvas.emit("click");
    vi.advanceTimersByTime(279);
    expect(host.eventTypes()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(host.eventTypes()).toEqual(["image-activate"]);

    canvas.emit("click");
    canvas.emit("dblclick", { clientX: 900, clientY: 600 });
    vi.advanceTimersByTime(1000);
    expect(host.eventTypes()).toEqual(["image-activate", "image-double-activate"]);
  });

  it("a double click zooms to one image pixel per CSS pixel around the pointer, and back to fit", () => {
    const { canvas, scene } = editedViewport();
    canvas.emit("dblclick", { clientX: 900, clientY: 600 });
    expect(scene.viewport.scale).toBe(1);
    expect(scene.viewport.userInteracted).toBe(true);
    expect(scene.imagePoint(900, 600)).toEqual({ x: 0.75, y: 0.75 });
    canvas.emit("dblclick", { clientX: 100, clientY: 100 });
    expect([scene.viewport.scale, scene.viewport.offsetX, scene.viewport.offsetY]).toEqual([0.5, 0, 0]);
    expect(scene.viewport.userInteracted).toBe(false);
  });

  it("a listener that claims the double activation keeps the viewport as it is", () => {
    const { canvas, host, scene } = editedViewport();
    host.dispatchEvent = (event) => event.type !== "image-double-activate";
    canvas.emit("dblclick", { clientX: 900, clientY: 600 });
    expect(scene.viewport.scale).toBe(0.5);
  });

  it("a quick horizontal swipe navigates at fit but pans a zoomed image", () => {
    const { canvas, host, scene } = editedViewport();
    canvas.emit("pointerdown", touch(1, 800, 400));
    canvas.emit("pointermove", touch(1, 700, 405));
    vi.advanceTimersByTime(200);
    canvas.emit("pointerup", touch(1, 700, 405));
    expect(host.events.map((event) => [event.type, event.detail])).toEqual([["image-swipe", { delta: 1 }]]);

    scene.viewport.scale = 2;
    scene.viewport.userInteracted = true;
    canvas.emit("pointerdown", touch(1, 800, 400));
    canvas.emit("pointermove", touch(1, 700, 405));
    canvas.emit("pointerup", touch(1, 700, 405));
    expect(host.events).toHaveLength(1);
    expect(scene.viewport.offsetX).toBe(-100);
  });

  it("one tap activates and two quick taps double-activate", () => {
    const { canvas, host } = editedViewport();
    const tap = () => {
      canvas.emit("pointerdown", touch(1, 600, 400));
      vi.advanceTimersByTime(50);
      canvas.emit("pointerup", touch(1, 600, 400));
    };
    tap();
    vi.advanceTimersByTime(1000);
    expect(host.eventTypes()).toEqual(["image-activate"]);
    tap();
    vi.advanceTimersByTime(100);
    tap();
    vi.advanceTimersByTime(1000);
    expect(host.eventTypes()).toEqual(["image-activate", "image-double-activate"]);
  });

  it("the click the webview sends after a touch is ignored", () => {
    const { canvas, host } = editedViewport();
    canvas.emit("pointerdown", touch(1, 600, 400));
    canvas.emit("pointerup", touch(1, 600, 400));
    canvas.emit("click");
    vi.advanceTimersByTime(1000);
    expect(host.eventTypes()).toEqual(["image-activate"]);
  });

  it("holding the pointer on the image previews until release and is not a click", () => {
    const { canvas, host } = editedViewport();
    canvas.emit("pointerdown", { clientX: 600, clientY: 400 });
    vi.advanceTimersByTime(499);
    expect(host.eventTypes()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(host.eventTypes()).toEqual(["image-preview-start"]);
    canvas.emit("pointerup");
    canvas.emit("click");
    vi.advanceTimersByTime(500);
    expect(host.eventTypes()).toEqual(["image-preview-start", "image-preview-end"]);
  });

  it("moving the pointer or pressing outside the image does not start a preview", () => {
    const { canvas, host, scene } = editedViewport();
    canvas.emit("pointerdown", { clientX: 600, clientY: 400 });
    canvas.emit("pointermove", { clientX: 620, clientY: 400 });
    vi.advanceTimersByTime(1000);
    canvas.emit("pointerup");

    scene.viewport.fitScale = 0.25;
    scene.viewport.scale = 0.25;
    canvas.emit("pointerdown", { clientX: 10, clientY: 10 });
    vi.advanceTimersByTime(1000);
    expect(host.eventTypes()).toEqual([]);
  });
});

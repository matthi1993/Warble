import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { editedViewport, expectInteractionPreview } from "./support/edited-viewport";
import { fakeBitmap } from "./support/viewer-fakes";
import { createViewer, installBrowser, uninstallBrowser } from "./support/viewer-harness";

describe("viewer while zooming and panning", () => {
  beforeEach(() => void installBrowser());
  afterEach(uninstallBrowser);

  it("wheel zoom uses a reduced preview then restores detail using the same full source", () => {
    const { canvas, pipeline, full, draw, renderedSize } = editedViewport();
    draw();
    expect(renderedSize()).toEqual([1200, 800]);
    const wheel = canvas.emit("wheel", { clientX: 600, clientY: 400, deltaY: -10 });
    expect(wheel.defaultPrevented).toBe(true);
    draw();
    expectInteractionPreview(pipeline.lastRender);
    expect(pipeline.lastRender.source).toBe(full);
    vi.advanceTimersByTime(119);
    draw();
    expectInteractionPreview(pipeline.lastRender);
    vi.advanceTimersByTime(1);
    draw();
    expect(renderedSize()).toEqual([1200, 800]);
    expect(pipeline.lastRender.source).toBe(full);
  });

  it("pan and pinch keep the lightweight preview until the last pointer ends or cancels", () => {
    const { canvas, scene, pipeline, draw, renderedSize } = editedViewport();
    scene.viewport.scale = 0.75;
    canvas.emit("pointerdown", { clientX: 600, clientY: 400 });
    canvas.emit("pointermove", { clientX: 610, clientY: 410 });
    draw();
    expectInteractionPreview(pipeline.lastRender);
    expect(vi.getTimerCount()).toBe(0);
    canvas.emit("pointerup");
    draw();
    expect(renderedSize()).toEqual([1200, 800]);

    canvas.emit("pointerdown", { pointerType: "touch", pointerId: 1, clientX: 400, clientY: 400 });
    canvas.emit("pointerdown", { pointerType: "touch", pointerId: 2, clientX: 800, clientY: 400 });
    canvas.emit("pointermove", { pointerType: "touch", pointerId: 2, clientX: 900, clientY: 400 });
    draw();
    expectInteractionPreview(pipeline.lastRender);
    canvas.emit("pointerup", { pointerType: "touch", pointerId: 2 });
    expect(scene.quality.reduced).toBe(true);
    canvas.emit("pointercancel", { pointerType: "touch", pointerId: 1 });
    draw();
    expect(renderedSize()).toEqual([1200, 800]);
    expect(scene.quality.reduced).toBe(false);
  });

  it("zooming past either wheel limit keeps full quality and does not prolong an existing preview", () => {
    const { canvas, scene, draw, renderedSize } = editedViewport();
    const wheel = (deltaY: number) => canvas.emit("wheel", { clientX: 600, clientY: 400, deltaY });
    for (let event = 0; event < 10; event++) wheel(100);
    expect(scene.quality.reduced).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(scene.viewport.userInteracted).toBe(false);
    draw();
    expect(renderedSize()).toEqual([1200, 800]);
    wheel(-100);
    expect(scene.quality.reduced).toBe(true);
    wheel(10000);
    wheel(100);
    expect(scene.viewport.scale).toBe(scene.viewport.fitScale);
    expect(scene.quality.reduced).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    scene.viewport.scale = 20;
    wheel(-100);
    expect(scene.quality.reduced).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("panning or pinching beyond fit does not soften an unmoving image", () => {
    const { canvas, scene } = editedViewport();
    canvas.emit("pointerdown", { clientX: 600, clientY: 400 });
    canvas.emit("pointermove", { clientX: 610, clientY: 410 });
    expect(scene.quality.reduced).toBe(false);
    canvas.emit("pointerup");
    canvas.emit("pointerdown", { pointerType: "touch", pointerId: 1, clientX: 400, clientY: 400 });
    canvas.emit("pointerdown", { pointerType: "touch", pointerId: 2, clientX: 800, clientY: 400 });
    canvas.emit("pointermove", { pointerType: "touch", pointerId: 2, clientX: 700, clientY: 400 });
    expect(scene.viewport.scale).toBe(scene.viewport.fitScale);
    expect(scene.quality.reduced).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("the wheel is swallowed and does not zoom while the crop tool is open", () => {
    const { canvas, host, scene } = editedViewport();
    host.cropMode = true;
    const wheel = canvas.emit("wheel", { clientX: 600, clientY: 400, deltaY: -100 });
    expect(wheel.defaultPrevented).toBe(true);
    expect(scene.viewport.scale).toBe(0.5);
  });
});

describe("viewer following its container and the screen", () => {
  afterEach(uninstallBrowser);

  it("auto rotation follows the viewport with side panels open and resets zoom when the iPad turns", () => {
    const window = installBrowser({ width: 1366, height: 1024, pixelRatio: 2 });
    const { host, scene, sources, connect } = createViewer({ width: 400, height: 600 });
    const bitmap = fakeBitmap(4000, 6000);
    host.autoRotate = true;
    sources.setHd("photo", bitmap);
    connect();
    expect(scene.surface.size).toEqual({ width: 800, height: 1200 });
    const turned = scene.geometry.image()!.source;
    expect([turned.width, turned.height]).toEqual([6000, 4000]);

    scene.viewport.userInteracted = true;
    scene.viewport.scale = 3;
    scene.viewport.offsetX = 100;
    scene.viewport.offsetY = 200;
    window.innerWidth = 1024;
    window.innerHeight = 1366;
    scene.resize();
    expect(scene.geometry.image()!.source).toBe(bitmap);
    expect(scene.viewport.scale).toBe(scene.viewport.fitScale);
    expect([scene.viewport.offsetX, scene.viewport.offsetY]).toEqual([0, 0]);

    host.editing = true;
    window.innerWidth = 1366;
    window.innerHeight = 1024;
    expect(scene.geometry.image()!.source).toBe(bitmap);
  });

  it("keeps the user's zoom when the canvas is resized without turning", () => {
    installBrowser();
    const { canvas, scene, full } = editedViewport();
    scene.viewport.userInteracted = true;
    scene.viewport.scale = 2;
    canvas.cssWidth = 1000;
    scene.resize();
    expect(scene.viewport.scale).toBe(2);
    expect(scene.viewport.fitScale).toBe(1000 / full.width);
    canvas.cssWidth = 500;
    scene.resize();
    expect(scene.viewport.scale).toBe(scene.viewport.fitScale);
  });
});

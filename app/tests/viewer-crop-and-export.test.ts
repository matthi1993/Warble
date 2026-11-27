import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { editedViewport } from "./support/edited-viewport";
import { fakeBitmap } from "./support/viewer-fakes";
import { createViewer, ignoredContext, installBrowser, uninstallBrowser } from "./support/viewer-harness";

const squareFrame = { x: (1 - 2 / 3) / 2, y: 0, width: 2 / 3, height: 1 };

function cropTool(aspect: number | null = 3 / 2) {
  const fixture = editedViewport();
  fixture.edits.cropIsEnabled = true;
  fixture.change({ cropMode: true, cropAspect: aspect });
  fixture.scene.resize();
  return fixture;
}

describe("viewer crop tool", () => {
  beforeEach(() => void installBrowser());
  afterEach(uninstallBrowser);

  it("opens on the saved crop, or on the largest frame of the requested aspect", () => {
    expect(cropTool(1).viewer.getCropFrame()).toEqual(squareFrame);

    const saved = editedViewport();
    saved.edits.cropIsEnabled = true;
    saved.edits.savedCrop = { x: 0.1, y: 0.2, width: 0.3, height: 0.4, rotation: 0 };
    saved.edits.listener!.onEdit("photo");
    saved.change({ cropMode: true, cropAspect: 1 });
    expect(saved.viewer.getCropFrame()).toEqual({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 });
    saved.change({ cropMode: false });
    expect(saved.viewer.getCropFrame()).toBeNull();
  });

  it("shows the cursor for the handle under the pointer", () => {
    const { canvas, host } = cropTool();
    const cursorAt = (clientX: number, clientY: number) => {
      canvas.emit("pointermove", { clientX, clientY });
      return host.cursor;
    };
    expect(cursorAt(2, 2)).toBe("nwse");
    expect(cursorAt(1198, 3)).toBe("nesw");
    expect(cursorAt(600, 5)).toBe("ns");
    expect(cursorAt(1195, 400)).toBe("ew");
    expect(cursorAt(600, 400)).toBe("move");
  });

  it("dragging a corner keeps the aspect, reports every change and commits on release", () => {
    const { canvas, host, viewer } = cropTool();
    canvas.emit("pointerdown", { clientX: 1200, clientY: 800 });
    canvas.emit("pointermove", { clientX: 900, clientY: 700 });
    expect(viewer.getCropFrame()).toEqual({ x: 0, y: 0, width: 0.75, height: 0.75 });
    canvas.emit("pointerup");
    expect(host.eventTypes()).toEqual(["crop-change", "crop-change", "crop-commit"]);
    expect(host.events[0].detail).toEqual({ x: 0, y: 0, width: 0.75, height: 0.75 });
    canvas.emit("pointermove", { clientX: 600, clientY: 300 });
    expect(viewer.getCropFrame()!.width).toBe(0.75);
  });

  it("changing the aspect or the rotation re-frames the crop and reports it", () => {
    const { host, viewer, change } = cropTool();
    change({ cropAspect: 1 });
    expect(viewer.getCropFrame()).toEqual(squareFrame);
    change({ rotation: 10 });
    const rotated = viewer.getCropFrame()!;
    expect(rotated.width).toBeLessThan(2 / 3);
    expect(host.eventTypes()).toEqual(["crop-change", "crop-change"]);
    expect(host.events[1].detail).toEqual(rotated);
  });

  it("a line drawn in horizon mode reports the rotation that levels it", () => {
    const { canvas, host, change } = cropTool();
    change({ horizonMode: true });
    expect(host.cursor).toBe("horizon");
    canvas.emit("pointerdown", { clientX: 300, clientY: 400 });
    canvas.emit("pointermove", { clientX: 900, clientY: 500 });
    canvas.emit("pointerup");
    expect(host.eventTypes()).toEqual(["horizon-line"]);
    expect(host.events[0].detail).toBeCloseTo(-(Math.atan2(200, 1200) * 180) / Math.PI);

    canvas.emit("pointerdown", { clientX: 300, clientY: 400 });
    canvas.emit("pointerup");
    expect(host.events).toHaveLength(1);
  });
});

describe("viewer export", () => {
  beforeEach(() => {
    installBrowser();
    vi.stubGlobal("OffscreenCanvas", class {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return ignoredContext;
      }
      async convertToBlob(): Promise<Blob> {
        return new Blob([new Uint8Array([this.width, this.height])]);
      }
    });
  });
  afterEach(uninstallBrowser);

  it("exports the rotated and cropped full-resolution photo with the photo layer only", async () => {
    const { host, images, edits, pipeline, viewer, connect } = createViewer();
    const analog = { vignette: 20, halation: 0, chromaticAberration: 0 };
    edits.layers = { photo: { analog }, post: { analog } };
    edits.cropIsEnabled = true;
    edits.savedCrop = { x: 0, y: 0, width: 0.5, height: 0.25, rotation: 90 };
    images.hdCache.set("photo", fakeBitmap(200, 100));
    host.path = "photo";
    connect();
    const exported = viewer.exportJpeg();
    images.fullRequests[0].resolve(fakeBitmap(400, 200));
    expect([...(await exported)]).toEqual([100, 100]);
    expect(pipeline.lastRender.recipe).toEqual({ photo: { analog }, post: {} });
    expect(pipeline.lastRender).toMatchObject({
      region: { x: 0, y: 0, width: 100, height: 100 },
      outputWidth: 100,
      outputHeight: 100,
    });
    expect([pipeline.lastRender.source.width, pipeline.lastRender.source.height]).toEqual([200, 400]);
  });

  it("exports the untouched photo while comparing with the original", async () => {
    const { host, images, edits, pipeline, viewer } = createViewer();
    const full = fakeBitmap(400, 200);
    edits.cropIsEnabled = true;
    edits.savedCrop = { x: 0, y: 0, width: 0.5, height: 0.25, rotation: 90 };
    host.path = "photo";
    host.previewOriginal = true;
    const exported = viewer.exportJpeg();
    images.fullRequests[0].resolve(full);
    await exported;
    expect(pipeline.lastRender).toMatchObject({ source: full, recipe: { photo: {}, post: {} }, outputWidth: 400 });
  });

  it("refuses to export without a photo or when the photo changes meanwhile", async () => {
    const { host, images, viewer } = createViewer();
    await expect(viewer.exportJpeg()).rejects.toThrow("no photo is loaded");
    host.path = "first";
    const exported = viewer.exportJpeg();
    host.path = "second";
    images.fullRequests[0].resolve(fakeBitmap(400, 200));
    await expect(exported).rejects.toThrow("photo changed during export");
  });
});

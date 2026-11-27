import { describe, expect, it } from "vitest";
import { ViewLayout, Viewport, type ViewportBounds } from "../src";

function bounds(image: ViewportBounds["image"] = { width: 2400, height: 1600 }): ViewportBounds {
  const canvas = { width: 1200, height: 800 };
  return { canvas, view: canvas, image };
}

describe("Viewport", () => {
  it("follows the fit until the user zooms, and returns to it when a fit is forced", () => {
    const viewport = new Viewport();
    viewport.fit("fit", bounds());
    expect([viewport.scale, viewport.fitScale]).toEqual([0.5, 0.5]);

    viewport.scale = 2;
    viewport.offsetX = 40;
    viewport.userInteracted = true;
    viewport.fit("fit", bounds());
    expect([viewport.scale, viewport.offsetX]).toEqual([2, 40]);

    viewport.forceFit();
    viewport.fit("fit", bounds());
    expect([viewport.scale, viewport.offsetX, viewport.userInteracted]).toEqual([0.5, 0, false]);
  });

  it("keeps a forced fit pending while there is no image", () => {
    const viewport = new Viewport();
    viewport.scale = 3;
    viewport.userInteracted = true;
    viewport.forceFit();
    viewport.fit("fit", bounds(null));
    expect([viewport.scale, viewport.fitScale]).toEqual([3, 1]);
    viewport.fit("fit", bounds());
    expect(viewport.scale).toBe(0.5);
  });

  it("zooms around a point so the image pixel under it stays put", () => {
    const viewport = new Viewport();
    viewport.fit("fit", bounds());
    const before = viewport.imageRect(bounds().canvas, bounds().image!);
    const pixelUnderCursor = (900 - before.x) / viewport.scale;
    viewport.zoomAround(900, 600, 2, bounds());
    const after = viewport.imageRect(bounds().canvas, bounds().image!);
    expect((900 - after.x) / viewport.scale).toBeCloseTo(pixelUnderCursor);
    expect(viewport.scale).toBe(2);
  });

  it("centres an image smaller than the view and stops panning at the image edges", () => {
    const viewport = new Viewport();
    viewport.fit("fit", bounds());
    expect(viewport.place(0.5, 300, -200, bounds())).toBe(false);
    expect([viewport.offsetX, viewport.offsetY]).toEqual([0, 0]);

    expect(viewport.place(1, 5000, -5000, bounds())).toBe(true);
    expect([viewport.offsetX, viewport.offsetY]).toEqual([600, -400]);
    expect(viewport.place(1, 9000, -9000, bounds())).toBe(false);
  });

  it("limits zoom to twenty times the fit or twenty device pixels per image pixel", () => {
    const viewport = new Viewport();
    viewport.fit("fit", bounds());
    expect(viewport.minScale).toBe(0.5);
    expect(viewport.maxScale(1)).toBe(20);
    expect(viewport.maxScale(2)).toBe(40);
    viewport.fit("fit", bounds({ width: 120, height: 80 }));
    expect(viewport.maxScale(2)).toBe(200);
  });

  it("reset drops zoom and pan at once and snaps to the next fit", () => {
    const viewport = new Viewport();
    viewport.fit("fit", bounds());
    viewport.place(1, 100, 100, bounds());
    viewport.userInteracted = true;
    viewport.reset();
    expect([viewport.scale, viewport.offsetX, viewport.offsetY]).toEqual([1, 0, 0]);
    viewport.fit("fill", bounds({ width: 600, height: 1600 }));
    expect(viewport.scale).toBe(2);
    expect(viewport.isFitting).toBe(true);
  });
});

describe("ViewLayout", () => {
  it("scales the frame and proofing margin by the pixel ratio", () => {
    const layout = new ViewLayout({ width: 1200, height: 800 }, 10, 20, 2);
    expect([layout.proofingInset, layout.frameInset, layout.inset]).toEqual([40, 20, 60]);
    expect(layout.view).toEqual({ width: 1080, height: 680 });
  });

  it("never lets the margins swallow the whole canvas", () => {
    const layout = new ViewLayout({ width: 101, height: 301 }, 80, 30, 1);
    expect([layout.proofingInset, layout.frameInset]).toEqual([30, 20]);
    expect(layout.view).toEqual({ width: 1, height: 201 });
  });
});

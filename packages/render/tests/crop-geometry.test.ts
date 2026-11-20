import { describe, expect, it } from "vitest";
import { CropFrameDrag, RotatedImageBounds, enforceAspect, type CropFrame } from "../src";

const image = { width: 3000, height: 2000 };
const centred: CropFrame = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };

function expectFrame(actual: CropFrame, expected: CropFrame): void {
  for (const key of ["x", "y", "width", "height"] as const) expect(actual[key]).toBeCloseTo(expected[key], 9);
}

function pixelAspect(frame: CropFrame): number {
  return (frame.width * image.width) / (frame.height * image.height);
}

describe("CropFrameDrag", () => {
  it("moves the frame without resizing it and stops at the image edges", () => {
    const drag = new CropFrameDrag("move", 0.5, 0.5, centred);
    expectFrame(drag.moveTo(0.6, 0.4, 3 / 2, image).frame, { ...centred, x: 0.35, y: 0.15 });
    expectFrame(drag.moveTo(5, -5, 3 / 2, image).frame, { ...centred, x: 0.5, y: 0 });
  });

  it("resizes freely from an edge when no aspect is locked and keeps a minimum size", () => {
    const drag = new CropFrameDrag("e", 0.75, 0.5, centred);
    expectFrame(drag.moveTo(0.85, 0.9, null, image).frame, { ...centred, width: 0.6 });
    expectFrame(drag.moveTo(-1, 0.5, null, image).frame, { ...centred, width: 0.02 });
  });

  it("keeps the locked aspect and the opposite corner while a corner is dragged", () => {
    const drag = new CropFrameDrag("se", 0.75, 0.75, centred);
    const { frame, orientationFlipped } = drag.moveTo(0.95, 0.8, 3 / 2, image);
    expect(orientationFlipped).toBe(false);
    expect(pixelAspect(frame)).toBeCloseTo(3 / 2);
    expect([frame.x, frame.y]).toEqual([0.25, 0.25]);
    expect(frame.x + frame.width).toBeLessThanOrEqual(1);
  });

  it("inverts the aspect when a corner drag turns a landscape frame into a portrait one", () => {
    const drag = new CropFrameDrag("se", 0.75, 0.75, centred);
    const { frame, orientationFlipped } = drag.moveTo(0.4, 0.95, 3 / 2, image);
    expect(orientationFlipped).toBe(true);
    expect(pixelAspect(frame)).toBeCloseTo(2 / 3);
    expect(drag.moveTo(0.4, 0.95, 1, image).orientationFlipped).toBe(false);
  });
});

describe("enforceAspect", () => {
  it("derives the width from a dragged horizontal edge around the frame's centre line", () => {
    const proposed = { ...centred, y: 0.05, height: 0.7 };
    const frame = enforceAspect(proposed, centred, 1, "n", image);
    expectFrame(frame, { x: 0.5 - 0.7 / 3, y: 0.05, width: (0.7 * 2) / 3, height: 0.7 });
  });

  it("shrinks a frame that would leave the image and keeps its aspect", () => {
    const proposed = { x: 0.25, y: 0.25, width: 0.75, height: 0.75 };
    const frame = enforceAspect(proposed, centred, 16 / 9, "se", image);
    expect(frame.x + frame.width).toBeLessThanOrEqual(1 + 1e-9);
    expect(frame.y + frame.height).toBeLessThanOrEqual(1 + 1e-9);
    expect(pixelAspect(frame)).toBeCloseTo(16 / 9);
  });
});

describe("RotatedImageBounds", () => {
  const upright = new RotatedImageBounds(image, image, 0);
  const tilted = new RotatedImageBounds(image, { width: 3302, height: 2491 }, 10);

  it("starts with the largest centred frame of the requested aspect", () => {
    expectFrame(upright.largestFrame(null), { x: 0, y: 0, width: 1, height: 1 });
    expectFrame(upright.largestFrame(1), { x: 1 / 6, y: 0, width: 2 / 3, height: 1 });
    expectFrame(upright.largestFrame(3), { x: 0, y: 0.25, width: 1, height: 0.5 });
    expectFrame(upright.largestFrame(Number.NaN), { x: 0, y: 0, width: 1, height: 1 });
  });

  it("starts a rotated image with a frame that shows no blank corners", () => {
    for (const aspect of [null, 1, 3 / 2, 2 / 3]) {
      const frame = tilted.largestFrame(aspect);
      expect(tilted.contains(frame)).toBe(true);
      expect(frame.x).toBeCloseTo((1 - frame.width) / 2);
      expect(frame.width).toBeLessThan(1);
    }
    const locked = tilted.largestFrame(3 / 2);
    expect((locked.width * 3302) / (locked.height * 2491)).toBeCloseTo(3 / 2);
  });

  it("accepts every frame on an upright image but rejects blank corners of a rotated one", () => {
    const whole = { x: 0, y: 0, width: 1, height: 1 };
    expect(upright.contains(whole)).toBe(true);
    expect(tilted.contains(whole)).toBe(false);
    expect(tilted.contains({ x: 0.4, y: 0.4, width: 0.2, height: 0.2 })).toBe(true);
  });

  it("pulls a frame that leaves the rotated image back towards a valid one", () => {
    const fallback = tilted.largestFrame(3 / 2);
    const whole = { x: 0, y: 0, width: 1, height: 1 };
    const constrained = tilted.constrain(whole, fallback);
    expect(tilted.contains(constrained)).toBe(true);
    expect(constrained.width).toBeGreaterThanOrEqual(fallback.width);
    expect(tilted.constrain(fallback, whole)).toBe(fallback);
    expect(tilted.constrain(whole, whole)).toBe(whole);
  });
});

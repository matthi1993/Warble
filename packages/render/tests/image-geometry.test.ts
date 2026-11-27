import { describe, expect, it } from "vitest";
import {
  ImageGeometry,
  PresentationRotator,
  SourceRotator,
  cropRegion,
  normalizeRotation,
  type RotatedCanvas,
} from "../src";
import { FakeCanvas, fakeImage } from "./support/canvas-fakes";

function rotatorWithFakes() {
  const canvases: FakeCanvas[] = [];
  const rotator = new SourceRotator((width, height) => {
    const canvas = new FakeCanvas(width, height);
    canvases.push(canvas);
    return canvas as unknown as RotatedCanvas;
  });
  return { rotator, canvases };
}

function geometryWithFakes() {
  const { rotator, canvases: rotations } = rotatorWithFakes();
  const turns: FakeCanvas[] = [];
  const presentation = new PresentationRotator(() => {
    const canvas = new FakeCanvas();
    turns.push(canvas);
    return canvas as unknown as HTMLCanvasElement;
  });
  return { geometry: new ImageGeometry(rotator, presentation), rotations, turns };
}

describe("normalizeRotation", () => {
  it("folds any angle into (-180, 180] and treats non-numbers as no rotation", () => {
    expect([0, 90, 180, 181, 270, 360, -90, -181, 725].map(normalizeRotation)).toEqual([
      0, 90, 180, -179, -90, 0, -90, 179, 5,
    ]);
    expect(normalizeRotation(Number.NaN)).toBe(0);
    expect(normalizeRotation(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("SourceRotator", () => {
  it("draws the source rotated about the centre of its rotated bounding box", () => {
    const { rotator, canvases } = rotatorWithFakes();
    const source = fakeImage(400, 200);
    const rotated = rotator.rotate(source, 90, "medium");
    expect([rotated!.width, rotated!.height]).toEqual([200, 400]);
    const { recording } = canvases[0];
    expect(recording.argsOf("translate")).toEqual([[100, 200]]);
    expect(recording.argsOf("rotate")[0][0]).toBeCloseTo(Math.PI / 2);
    expect(recording.argsOf("drawImage")).toEqual([[source, -200, -100]]);
    expect(recording.argsOf("set imageSmoothingQuality")).toEqual([["medium"]]);
  });

  it("rotated full-resolution sources remain stable across repeated requests", () => {
    const { rotator, canvases } = rotatorWithFakes();
    const source = fakeImage(6000, 4000);
    const rotated = rotator.get(source, 10, "high");
    for (let request = 0; request < 10; request++) expect(rotator.get(source, 10, "high")).toBe(rotated);
    expect(canvases).toHaveLength(1);
    expect(rotator.get(source, 11, "high")).not.toBe(rotated);
    expect(canvases).toHaveLength(2);
  });

  it("returns the source itself when unrotated or when no canvas context is available", () => {
    const { rotator, canvases } = rotatorWithFakes();
    const source = fakeImage(400, 200);
    expect(rotator.get(source, 0, "high")).toBe(source);
    expect(canvases).toHaveLength(0);
    const withoutContext = new SourceRotator(() => {
      const canvas = new FakeCanvas();
      canvas.contextAvailable = false;
      return canvas as unknown as RotatedCanvas;
    });
    expect(withoutContext.get(source, 5, "high")).toBe(source);
  });

  it("keeps the rotations of the two most recent sources", () => {
    const { rotator, canvases } = rotatorWithFakes();
    const [first, second, third] = [fakeImage(4, 2), fakeImage(4, 2), fakeImage(4, 2)];
    rotator.get(first, 5, "high");
    rotator.get(second, 5, "high");
    rotator.get(third, 5, "high");
    rotator.get(second, 5, "high");
    expect(canvases).toHaveLength(3);
    rotator.get(first, 5, "high");
    expect(canvases).toHaveLength(4);
  });
});

describe("cropRegion", () => {
  it("is the whole image without a crop and at least one pixel with one", () => {
    const image = { width: 2000, height: 1000 };
    expect(cropRegion(image, null)).toEqual({ x: 0, y: 0, width: 2000, height: 1000 });
    expect(cropRegion(image, { x: 0.1, y: 0.2, width: 0.5, height: 0.25 })).toEqual({
      x: 200, y: 200, width: 1000, height: 250,
    });
    expect(cropRegion(image, { x: 2, y: -1, width: 0, height: 5 })).toEqual({
      x: 2000, y: 0, width: 1, height: 1000,
    });
  });
});

describe("ImageGeometry", () => {
  const request = { rotation: 0, crop: null, smoothingQuality: "high" as const, screenLandscape: null };

  it("shows the rotated source cropped in rotated coordinates", () => {
    const { geometry, rotations } = geometryWithFakes();
    const shown = geometry.resolve({
      ...request,
      source: fakeImage(400, 200),
      rotation: 90,
      crop: { x: 0.5, y: 0, width: 0.5, height: 0.5 },
    });
    expect(shown.source).toBe(rotations[0]);
    expect(shown.region).toEqual({ x: 100, y: 0, width: 100, height: 200 });
  });

  it("turns a portrait crop a quarter for a landscape screen and reuses the turned canvas", () => {
    const { geometry, turns } = geometryWithFakes();
    const source = fakeImage(4000, 6000);
    const crop = { x: 0, y: 0.5, width: 1, height: 0.5 };
    const landscape = geometry.resolve({ ...request, source, crop, screenLandscape: true });
    expect(landscape.source).toBe(source);

    const tall = { x: 0.25, y: 0, width: 0.5, height: 1 };
    const turned = geometry.resolve({ ...request, source, crop: tall, screenLandscape: true });
    expect(turned.source).toBe(turns[0]);
    expect(turned.region).toEqual({ x: 0, y: 0, width: 6000, height: 2000 });
    expect(turns[0].recording.argsOf("drawImage")).toEqual([[source, 1000, 0, 2000, 6000, 0, 0, 2000, 6000]]);

    geometry.resolve({ ...request, source, crop: tall, screenLandscape: true });
    expect(turns).toHaveLength(1);
    geometry.releasePresentation();
    geometry.resolve({ ...request, source, crop: tall, screenLandscape: true });
    expect(turns).toHaveLength(2);
  });

  it("leaves the image upright when it already matches the screen or auto-rotation is off", () => {
    const { geometry, turns } = geometryWithFakes();
    const source = fakeImage(4000, 6000);
    expect(geometry.resolve({ ...request, source, screenLandscape: false }).source).toBe(source);
    expect(geometry.resolve({ ...request, source, screenLandscape: null }).source).toBe(source);
    expect(turns).toHaveLength(0);
  });
});

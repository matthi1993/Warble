import { describe, expect, it } from "vitest";
import { imageViewScale, type Size } from "../src";

describe("imageViewScale", () => {
  it("iPad contain and cover fit every viewport orientation, including low resolution previews", () => {
    const tolerance = 1e-6;
    const images: Size[] = [
      { width: 320, height: 213 },
      { width: 213, height: 320 },
      { width: 6000, height: 4000 },
      { width: 4000, height: 6000 },
    ];
    for (const [width, height] of [[1024, 1366], [1366, 1024], [768, 1024], [1024, 768]]) {
      for (const pixelRatio of [1, 2, 3]) {
        const view = { width: width * pixelRatio, height: height * pixelRatio };
        for (const image of images) {
          const contain = imageViewScale("fit", image, view);
          const cover = imageViewScale("fill", image, view);
          expect(image.width * contain).toBeLessThanOrEqual(view.width + tolerance);
          expect(image.height * contain).toBeLessThanOrEqual(view.height + tolerance);
          const touchesWidth = Math.abs(image.width * contain - view.width) < tolerance;
          const touchesHeight = Math.abs(image.height * contain - view.height) < tolerance;
          expect(touchesWidth || touchesHeight).toBe(true);
          expect(image.width * cover).toBeGreaterThanOrEqual(view.width - tolerance);
          expect(image.height * cover).toBeGreaterThanOrEqual(view.height - tolerance);
        }
      }
    }
  });

  it("hybrid covers matching portrait and landscape shapes, and contains when cropping would be excessive", () => {
    const cases: [Size, Size][] = [
      [{ width: 3000, height: 2000 }, { width: 1366, height: 1024 }],
      [{ width: 2000, height: 3000 }, { width: 1024, height: 1366 }],
    ];
    for (const [image, view] of cases) {
      expect(imageViewScale("hybrid", image, view)).toBe(imageViewScale("fill", image, view));
      const turned = { width: view.height, height: view.width };
      expect(imageViewScale("hybrid", image, turned)).toBe(imageViewScale("fit", image, turned));
    }
  });
});

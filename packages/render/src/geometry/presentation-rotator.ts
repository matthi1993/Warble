import type { ImageSource } from "../pipeline/source-texture-cache";
import type { Rect } from "./rect";

/** Turns the shown region of a source by 90° so it matches the screen orientation. */
export class PresentationRotator {
  private cached: { source: ImageSource; key: string; canvas: HTMLCanvasElement } | null = null;

  constructor(
    private readonly canvasFactory: () => HTMLCanvasElement = () => document.createElement("canvas"),
  ) {}

  quarterTurn(source: ImageSource, region: Rect): HTMLCanvasElement | null {
    const key = [region.x, region.y, region.width, region.height].join(",");
    if (this.cached?.source === source && this.cached.key === key) return this.cached.canvas;
    const canvas = this.canvasFactory();
    canvas.width = Math.max(1, Math.round(region.height));
    canvas.height = Math.max(1, Math.round(region.width));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.translate(canvas.width, 0);
    context.rotate(Math.PI / 2);
    context.drawImage(
      source,
      region.x,
      region.y,
      region.width,
      region.height,
      0,
      0,
      canvas.height,
      canvas.width,
    );
    this.cached = { source, key, canvas };
    return canvas;
  }

  clear(): void {
    this.cached = null;
  }
}

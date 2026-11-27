import type { ImageSource } from "../pipeline/source-texture-cache";

export type ImageSmoothingQuality = "low" | "medium" | "high";
export type RotatedCanvas = HTMLCanvasElement | OffscreenCanvas;
export type CanvasFactory = (width: number, height: number) => RotatedCanvas;

/** Degrees folded into (-180, 180]. */
export function normalizeRotation(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  const turned = ((degrees % 360) + 360) % 360;
  return turned > 180 ? turned - 360 : turned;
}

function createCanvas(width: number, height: number): RotatedCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export class SourceRotator {
  private readonly cache = new Map<ImageSource, { rotation: number; canvas: RotatedCanvas }>();

  constructor(
    private readonly canvasFactory: CanvasFactory = createCanvas,
    private readonly capacity = 2,
  ) {}

  /** The cached rotation of `source`; the source itself when unrotated or when rotating fails. */
  get(source: ImageSource, rotation: number, quality: ImageSmoothingQuality): ImageSource {
    if (rotation === 0) return source;
    const cached = this.cache.get(source);
    if (cached?.rotation === rotation) return cached.canvas;
    const canvas = this.rotate(source, rotation, quality);
    if (!canvas) return source;
    this.cache.set(source, { rotation, canvas });
    if (this.cache.size > this.capacity) this.cache.delete(this.cache.keys().next().value!);
    return canvas;
  }

  rotate(source: ImageSource, rotation: number, quality: ImageSmoothingQuality): RotatedCanvas | null {
    const radians = (rotation * Math.PI) / 180;
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    const width = Math.max(1, Math.round(source.width * cos + source.height * sin));
    const height = Math.max(1, Math.round(source.width * sin + source.height * cos));
    const canvas = this.canvasFactory(width, height);
    const context = canvas.getContext("2d") as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!context) return null;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = quality;
    context.save();
    context.translate(width / 2, height / 2);
    context.rotate(radians);
    context.drawImage(source, -source.width / 2, -source.height / 2);
    context.restore();
    return canvas;
  }

  clear(): void {
    this.cache.clear();
  }
}

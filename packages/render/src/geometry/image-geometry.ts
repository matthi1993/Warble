import type { ImageSource } from "../pipeline/source-texture-cache";
import { cropRegion } from "./crop-region";
import { PresentationRotator } from "./presentation-rotator";
import type { Rect } from "./rect";
import { SourceRotator, type ImageSmoothingQuality } from "./source-rotator";

export interface GeometryRequest {
  readonly source: ImageSource;
  /** Degrees in (-180, 180]. */
  readonly rotation: number;
  /** Normalised crop, applied after the rotation. */
  readonly crop: Rect | null;
  readonly smoothingQuality: ImageSmoothingQuality;
  /** Screen orientation to match with a quarter turn; `null` keeps the image upright. */
  readonly screenLandscape: boolean | null;
}

/** The source to draw and the part of it, in source pixels, that is shown. */
export interface DisplayImage {
  readonly source: ImageSource;
  readonly region: Rect;
}

export class ImageGeometry {
  constructor(
    private readonly rotator = new SourceRotator(),
    private readonly presentation = new PresentationRotator(),
  ) {}

  resolve(request: GeometryRequest): DisplayImage {
    const source = this.rotated(request.source, request.rotation, request.smoothingQuality);
    const region = cropRegion(source, request.crop);
    const upright = { source, region };
    if (request.screenLandscape === null) return upright;
    if (region.width >= region.height === request.screenLandscape) return upright;
    const turned = this.presentation.quarterTurn(source, region);
    return turned ? { source: turned, region: cropRegion(turned, null) } : upright;
  }

  rotated(source: ImageSource, rotation: number, quality: ImageSmoothingQuality): ImageSource {
    return this.rotator.get(source, rotation, quality);
  }

  releaseRotations(): void {
    this.rotator.clear();
  }

  releasePresentation(): void {
    this.presentation.clear();
  }
}

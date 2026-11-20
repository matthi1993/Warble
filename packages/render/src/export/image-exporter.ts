import { cropRegion } from "../geometry/crop-region";
import type { Rect } from "../geometry/rect";
import { SourceRotator, type ImageSmoothingQuality } from "../geometry/source-rotator";
import type { ImageSource } from "../pipeline/source-texture-cache";
import { EMPTY_RECIPE, type RenderRecipe } from "../recipe/render-recipe";
import type { ImageRenderer } from "../view/image-view";
import { JpegEncoder } from "./jpeg-encoder";

export interface ExportRequest {
  readonly source: ImageSource;
  /** Degrees in (-180, 180]. */
  readonly rotation: number;
  /** Normalised crop, applied after the rotation. */
  readonly crop: Rect | null;
  /** Only the photo layer is exported; the post layer is a viewing look. */
  readonly recipe: RenderRecipe;
  readonly smoothingQuality: ImageSmoothingQuality;
}

/** Renders the source at its own resolution, so no viewport state ends up in the file. */
export class ImageExporter {
  constructor(
    private readonly renderer: ImageRenderer,
    private readonly rotator = new SourceRotator(),
    private readonly encoder = new JpegEncoder(),
  ) {}

  async exportJpeg(request: ExportRequest): Promise<Uint8Array> {
    const source = this.rotatedSource(request);
    const region = cropRegion(source, request.crop);
    const width = Math.max(1, Math.round(region.width));
    const height = Math.max(1, Math.round(region.height));
    const rendered = this.renderer.render({
      source,
      recipe: { photo: request.recipe.photo, post: EMPTY_RECIPE.post },
      region,
      outputWidth: width,
      outputHeight: height,
    });
    if (!rendered) throw new Error("could not render edited image");
    return this.encoder.encode(rendered, width, height);
  }

  private rotatedSource(request: ExportRequest): ImageSource {
    if (request.rotation === 0) return request.source;
    const rotated = this.rotator.rotate(request.source, request.rotation, request.smoothingQuality);
    if (!rotated) throw new Error("could not rotate image for export");
    return rotated;
  }
}

import type { RenderRecipe } from "../recipe/render-recipe";

/** The part of the source image a draw covers, as fractions of the full image. */
export interface SourceRegion {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

export interface StageFrame {
  readonly gl: WebGL2RenderingContext;
  readonly input: WebGLTexture;
  readonly recipe: RenderRecipe;
  readonly region: SourceRegion;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly outputWidth: number;
  readonly outputHeight: number;
  /** Full-quality output size; effect radii use it so reduced previews look the same. */
  readonly effectWidth: number;
  readonly effectHeight: number;
}

/**
 * One step of the pipeline. A stage reads `frame.input` and draws into the
 * framebuffer the pipeline has bound. The first stage of a pipeline receives
 * the source image and always runs; later stages run only when they would
 * change the image.
 */
export interface RenderStage {
  readonly id: string;
  changesImage(recipe: RenderRecipe): boolean;
  render(frame: StageFrame): boolean;
  dispose(): void;
}

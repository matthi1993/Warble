import { AnalogStage } from "../effects/analog/analog-stage";
import { EffectRegistry } from "../effects/effect-registry";
import type { Rect, Size } from "../geometry/rect";
import { RenderTargetPool } from "../gl/render-target-pool";
import type { RenderRecipe } from "../recipe/render-recipe";
import { AdjustmentStage } from "./adjustment-stage";
import type { RenderStage, StageFrame } from "./render-stage";
import { SourceTextureCache, type ImageSource } from "./source-texture-cache";

export interface RenderRequest {
  readonly source: ImageSource;
  readonly recipe: RenderRecipe;
  /** Source pixels to render. */
  readonly region: Rect;
  readonly outputWidth: number;
  readonly outputHeight: number;
  /** Full-quality output size when `output*` is a reduced preview. */
  readonly effectSize?: Size;
}

/**
 * Runs an image through an ordered list of stages on the GPU. Each stage
 * draws into an intermediate frame that the next one reads; the last active
 * stage draws to `canvas`.
 */
export class RenderPipeline {
  private gl: WebGL2RenderingContext | null = null;
  private sources: SourceTextureCache | null = null;
  private targets: RenderTargetPool | null = null;
  private unavailable = false;

  constructor(
    private readonly stages: readonly RenderStage[] = RenderPipeline.standardStages(),
    readonly canvas: HTMLCanvasElement = document.createElement("canvas"),
  ) {}

  static standardStages(effects = EffectRegistry.standard()): RenderStage[] {
    return [new AdjustmentStage(effects.shaderEffects), new AnalogStage("photo"), new AnalogStage("post")];
  }

  changesImage(recipe: RenderRecipe): boolean {
    return this.stages.some((stage) => stage.changesImage(recipe));
  }

  render(request: RenderRequest): HTMLCanvasElement | null {
    const gl = this.context();
    if (!gl) return null;
    const { source, recipe, region, outputWidth, outputHeight } = request;
    if (this.canvas.width !== outputWidth) this.canvas.width = outputWidth;
    if (this.canvas.height !== outputHeight) this.canvas.height = outputHeight;
    const sourceTexture = this.sources!.get(source);
    if (!sourceTexture) return null;

    const stages = this.stages.filter((stage, index) => index === 0 || stage.changesImage(recipe));
    const targets = this.targets!.ensure(stages.length - 1, outputWidth, outputHeight);
    if (!targets) return null;

    const frame: Omit<StageFrame, "input"> = {
      gl,
      recipe,
      region: {
        offsetX: region.x / source.width,
        offsetY: region.y / source.height,
        scaleX: region.width / source.width,
        scaleY: region.height / source.height,
      },
      sourceWidth: source.width,
      sourceHeight: source.height,
      outputWidth,
      outputHeight,
      effectWidth: request.effectSize?.width ?? outputWidth,
      effectHeight: request.effectSize?.height ?? outputHeight,
    };
    gl.viewport(0, 0, outputWidth, outputHeight);
    let input = sourceTexture;
    for (let index = 0; index < stages.length; index++) {
      const last = index === stages.length - 1;
      gl.bindFramebuffer(gl.FRAMEBUFFER, last ? null : targets[index].framebuffer);
      if (!stages[index].render({ ...frame, input })) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return null;
      }
      if (!last) input = targets[index].texture;
    }
    return this.canvas;
  }

  warmup(source: ImageSource): void {
    if (this.context()) this.sources!.get(source);
  }

  releaseSources(): void {
    this.targets?.release();
    this.sources?.clear();
  }

  dispose(): void {
    if (!this.gl) return;
    for (const stage of this.stages) stage.dispose();
    this.releaseSources();
    this.gl = null;
    this.sources = null;
    this.targets = null;
  }

  private context(): WebGL2RenderingContext | null {
    if (this.gl || this.unavailable) return this.gl;
    const gl = this.canvas.getContext("webgl2", {
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    }) as WebGL2RenderingContext | null;
    if (!gl) {
      this.unavailable = true;
      console.warn("WebGL2 unavailable — editing tools disabled");
      return null;
    }
    this.gl = gl;
    this.sources = new SourceTextureCache(gl);
    this.targets = new RenderTargetPool(gl);
    return gl;
  }
}

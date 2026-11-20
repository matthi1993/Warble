import { FullscreenQuad } from "../../gl/fullscreen-quad";
import { ShaderProgram } from "../../gl/shader-program";
import type { RenderStage, StageFrame } from "../../pipeline/render-stage";
import type { LayerId, RenderRecipe } from "../../recipe/render-recipe";
import { isAnalogZero, normalizeAnalog, type AnalogSettings } from "./analog-settings";
import { ANALOG_FRAGMENT_SHADER, ANALOG_VERTEX_SHADER } from "./analog-shader";

const POSITION_ATTRIBUTE = 0;

/** Vignette, halation and chromatic aberration for one layer, sampled from the finished image. */
export class AnalogStage implements RenderStage {
  readonly id: string;
  private program: ShaderProgram | null = null;
  private quad: FullscreenQuad | null = null;

  constructor(private readonly layer: LayerId) {
    this.id = `analog-${layer}`;
  }

  changesImage(recipe: RenderRecipe): boolean {
    return this.settings(recipe) !== null;
  }

  render(frame: StageFrame): boolean {
    const settings = this.settings(frame.recipe);
    if (!settings || (!this.program && !this.initialize(frame.gl))) return false;
    const program = this.program!;
    const { gl, region } = frame;
    program.use();
    this.quad!.bind();
    program.set1i("u_edited", 0);
    program.set2f("u_srcOffset", region.offsetX, region.offsetY);
    program.set2f("u_srcScale", region.scaleX, region.scaleY);
    program.set2f("u_inputSize", frame.outputWidth, frame.outputHeight);
    const longestSide = Math.max(frame.sourceWidth, frame.sourceHeight);
    program.set2f("u_photoAspect", frame.sourceWidth / longestSide, frame.sourceHeight / longestSide);
    program.set1i("u_monochrome", this.isMonochrome(frame.recipe) ? 1 : 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, frame.input);
    const needsBlur = settings.halation > 0;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, needsBlur ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    if (needsBlur) gl.generateMipmap(gl.TEXTURE_2D);
    for (const [key, value] of Object.entries(settings)) program.set1f(`u_${key}`, value / 100);
    this.quad!.draw();
    return true;
  }

  dispose(): void {
    this.program?.dispose();
    this.quad?.dispose();
    this.program = null;
    this.quad = null;
  }

  private settings(recipe: RenderRecipe): AnalogSettings | null {
    const configured = recipe[this.layer].analog;
    if (!configured) return null;
    const settings = normalizeAnalog(configured);
    return isAnalogZero(settings) ? null : settings;
  }

  private isMonochrome(recipe: RenderRecipe): boolean {
    return recipe.photo.color?.blackAndWhite === true || recipe.post.color?.blackAndWhite === true;
  }

  private initialize(gl: WebGL2RenderingContext): boolean {
    const program = ShaderProgram.create(gl, ANALOG_VERTEX_SHADER, ANALOG_FRAGMENT_SHADER, "analog");
    if (!program) return false;
    const quad = new FullscreenQuad(gl, POSITION_ATTRIBUTE);
    if (!quad.ready) {
      program.dispose();
      quad.dispose();
      return false;
    }
    this.program = program;
    this.quad = quad;
    return true;
  }
}

import type { EffectTextures, EffectUniforms, ShaderEffect } from "../effects/shader-effect";
import { FullscreenQuad } from "../gl/fullscreen-quad";
import { ShaderProgram } from "../gl/shader-program";
import { layerSettings, type RenderRecipe } from "../recipe/render-recipe";
import { ProgramComposer } from "./program-composer";
import type { RenderStage, StageFrame } from "./render-stage";

interface BoundEffect {
  readonly effect: ShaderEffect<unknown>;
  readonly textures: EffectTextures;
}

const SOURCE_UNIT = 0;

/**
 * Reads the source region and applies every shader effect in one draw:
 * source-level effects first, then the photo layer, then the post layer.
 */
export class AdjustmentStage implements RenderStage {
  readonly id = "adjustments";
  private program: ShaderProgram | null = null;
  private quad: FullscreenQuad | null = null;
  private bound: BoundEffect[] = [];
  private failed = false;

  constructor(private readonly effects: readonly ShaderEffect<unknown>[]) {}

  changesImage(recipe: RenderRecipe): boolean {
    return this.effects.some(
      (effect) =>
        !effect.isNeutral(layerSettings(recipe.photo, effect.id)) ||
        !effect.isNeutral(layerSettings(recipe.post, effect.id)),
    );
  }

  render(frame: StageFrame): boolean {
    if (this.failed || (!this.program && !this.initialize(frame.gl))) return false;
    const program = this.program!;
    const { gl, region, recipe } = frame;
    program.use();
    this.quad!.bind();
    program.set2f("u_srcOffset", region.offsetX, region.offsetY);
    program.set2f("u_srcScale", region.scaleX, region.scaleY);
    program.set2f("u_sourceSize", frame.sourceWidth, frame.sourceHeight);

    const uniforms: EffectUniforms = {
      sourceScaleX: region.scaleX,
      sourceScaleY: region.scaleY,
      outputWidth: frame.effectWidth,
      outputHeight: frame.effectHeight,
      set1f: (name, value) => program.set1f(name, value),
      set1i: (name, value) => program.set1i(name, value),
      set2f: (name, x, y) => program.set2f(name, x, y),
      set3f: (name, x, y, z) => program.set3f(name, x, y, z),
      set3fv: (name, value) => program.set3fv(name, value),
    };
    for (const { effect, textures } of this.bound) {
      const layers = {
        photo: layerSettings(recipe.photo, effect.id),
        post: layerSettings(recipe.post, effect.id),
      };
      effect.bind(uniforms, layers, textures);
    }

    this.bindTexture(gl, SOURCE_UNIT, frame.input);
    let unit = SOURCE_UNIT;
    for (const { textures } of this.bound) {
      for (const texture of Object.values(textures)) this.bindTexture(gl, ++unit, texture.handle);
    }
    this.quad!.draw();
    return true;
  }

  dispose(): void {
    this.program?.dispose();
    this.quad?.dispose();
    for (const { textures } of this.bound) {
      for (const texture of Object.values(textures)) texture.dispose();
    }
    this.program = null;
    this.quad = null;
    this.bound = [];
  }

  private initialize(gl: WebGL2RenderingContext): boolean {
    const composer = new ProgramComposer(this.effects.map((effect) => effect.shader));
    const program = ShaderProgram.create(gl, composer.vertexSource(), composer.fragmentSource(), "editor");
    if (!program) return this.fail();
    this.program = program;
    program.use();
    program.set1i("u_tex", SOURCE_UNIT);
    this.quad = new FullscreenQuad(gl, program.attribute("a_pos"));
    this.bound = this.effects.map((effect) => ({ effect, textures: effect.createTextures(gl) }));
    let unit = SOURCE_UNIT;
    let texturesReady = true;
    for (const { textures } of this.bound) {
      for (const [sampler, texture] of Object.entries(textures)) {
        program.set1i(sampler, ++unit);
        texturesReady &&= !!texture.handle;
      }
    }
    return (this.quad.ready && texturesReady) || this.fail();
  }

  private bindTexture(gl: WebGL2RenderingContext, unit: number, texture: WebGLTexture | null): void {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  }

  private fail(): false {
    this.failed = true;
    return false;
  }
}

import type { EffectLayers } from "../effect";
import { ShaderEffect, type EffectUniforms } from "../shader-effect";
import { CurveLutTexture } from "./curve-lut-texture";
import { defaultCurve, isCurveZero, type CurveEdit } from "./curve-settings";
import { curveShader } from "./curve-shader";

type CurveTextures = { u_editLut: CurveLutTexture; u_postLut: CurveLutTexture };

export class CurveEffect extends ShaderEffect<CurveEdit, CurveTextures> {
  readonly id = "curve";
  readonly shader = curveShader;

  defaults(): CurveEdit {
    return defaultCurve();
  }

  isNeutral(settings: CurveEdit | null | undefined): boolean {
    return isCurveZero(settings);
  }

  createTextures(gl: WebGL2RenderingContext): CurveTextures {
    return { u_editLut: new CurveLutTexture(gl), u_postLut: new CurveLutTexture(gl) };
  }

  bind(uniforms: EffectUniforms, layers: EffectLayers<CurveEdit>, textures: CurveTextures): void {
    this.bindLayer(uniforms, "edit", layers.photo, textures.u_editLut);
    this.bindLayer(uniforms, "post", layers.post, textures.u_postLut);
  }

  private bindLayer(
    uniforms: EffectUniforms,
    prefix: "edit" | "post",
    curve: CurveEdit | null,
    lut: CurveLutTexture,
  ): void {
    const enabled = !!curve && !isCurveZero(curve);
    uniforms.set1i(`u_${prefix}LutEnabled`, enabled ? 1 : 0);
    if (enabled) lut.upload(curve);
  }
}

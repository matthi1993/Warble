import type { EffectLayers } from "../effect";
import { ShaderEffect, type EffectUniforms } from "../shader-effect";
import { defaultGrain, isGrainZero, type GrainSettings } from "./grain-settings";
import { grainShader } from "./grain-shader";
import { GrainTexture } from "./grain-texture";

type GrainTextures = { u_grainTexture: GrainTexture };

export class GrainEffect extends ShaderEffect<GrainSettings, GrainTextures> {
  readonly id = "grain";
  readonly shader = grainShader;

  defaults(): GrainSettings {
    return defaultGrain();
  }

  isNeutral(settings: GrainSettings | null | undefined): boolean {
    return isGrainZero(settings);
  }

  createTextures(gl: WebGL2RenderingContext): GrainTextures {
    return { u_grainTexture: new GrainTexture(gl) };
  }

  bind(uniforms: EffectUniforms, layers: EffectLayers<GrainSettings>): void {
    this.bindLayer(uniforms, "edit", layers.photo);
    this.bindLayer(uniforms, "", layers.post);
  }

  private bindLayer(uniforms: EffectUniforms, prefix: "edit" | "", settings: GrainSettings | null): void {
    const name = (key: string) => `u_${prefix}${prefix ? key[0].toUpperCase() + key.slice(1) : key}`;
    uniforms.set1f(name("grainSize"), settings?.size ?? 25);
    uniforms.set1f(name("grainAmount"), settings?.amount ?? 0);
    uniforms.set1f(name("grainFine"), settings?.fine ?? 0);
  }
}

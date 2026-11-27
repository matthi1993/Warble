import type { EffectLayers } from "../effect";
import { ShaderEffect, type EffectUniforms } from "../shader-effect";
import { defaultClarity, isClarityZero, type ClaritySettings } from "./clarity-settings";
import { clarityShader } from "./clarity-shader";

export class ClarityEffect extends ShaderEffect<ClaritySettings> {
  readonly id = "clarity";
  readonly shader = clarityShader;

  defaults(): ClaritySettings {
    return defaultClarity();
  }

  isNeutral(settings: ClaritySettings | null | undefined): boolean {
    return isClarityZero(settings);
  }

  bind(uniforms: EffectUniforms, layers: EffectLayers<ClaritySettings>): void {
    this.bindLayer(uniforms, "edit", layers.photo);
    this.bindLayer(uniforms, "post", layers.post);
    uniforms.set2f(
      "u_clarityStep",
      uniforms.sourceScaleX / uniforms.outputWidth,
      uniforms.sourceScaleY / uniforms.outputHeight,
    );
  }

  private bindLayer(uniforms: EffectUniforms, prefix: "edit" | "post", settings: ClaritySettings | null): void {
    const value = { ...defaultClarity(), ...settings };
    uniforms.set1f(`u_${prefix}Clarity`, value.clarity / 100);
    uniforms.set1f(`u_${prefix}Structure`, value.structure / 100);
  }
}

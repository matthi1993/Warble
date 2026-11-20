import type { EffectLayers } from "../effect";
import { ShaderEffect, type EffectUniforms } from "../shader-effect";
import { defaultBloom, isBloomZero, type BloomSettings } from "./bloom-settings";
import { bloomShader } from "./bloom-shader";

/** Bloom reads the untouched source, so only the post layer configures it. */
export class BloomEffect extends ShaderEffect<BloomSettings> {
  readonly id = "bloom";
  readonly shader = bloomShader;

  defaults(): BloomSettings {
    return defaultBloom();
  }

  isNeutral(settings: BloomSettings | null | undefined): boolean {
    return isBloomZero(settings);
  }

  bind(uniforms: EffectUniforms, layers: EffectLayers<BloomSettings>): void {
    const value = layers.post;
    const defaults = defaultBloom();
    uniforms.set1f("u_bloomStrength", value?.strength ?? 0);
    uniforms.set1f("u_bloomThreshold", (value?.threshold ?? defaults.threshold) / 100);
    uniforms.set1f("u_bloomRadius", value?.radius ?? defaults.radius);
    uniforms.set1f("u_bloomSoftness", (value?.softness ?? defaults.softness) / 100);
    uniforms.set1f("u_bloomSpread", (value?.spread ?? defaults.spread) / 100);
    uniforms.set2f(
      "u_bloomStep",
      uniforms.sourceScaleX / uniforms.outputWidth,
      uniforms.sourceScaleY / uniforms.outputHeight,
    );
  }
}

import type { EffectLayers } from "../effect";
import { ShaderEffect, type EffectUniforms } from "../shader-effect";
import { TONE_GLOBAL_RESPONSE } from "./tone-response";
import { defaultTone, isToneZero, type ToneEdit } from "./tone-settings";
import { toneShader } from "./tone-shader";

export class ToneEffect extends ShaderEffect<ToneEdit> {
  readonly id = "tone";
  readonly shader = toneShader;

  defaults(): ToneEdit {
    return defaultTone();
  }

  isNeutral(settings: ToneEdit | null | undefined): boolean {
    return isToneZero(settings);
  }

  bind(uniforms: EffectUniforms, layers: EffectLayers<ToneEdit>): void {
    this.bindLayer(uniforms, "", layers.photo);
    this.bindLayer(uniforms, "post", layers.post);
  }

  private bindLayer(uniforms: EffectUniforms, prefix: "" | "post", settings: Partial<ToneEdit> | null): void {
    const value = { ...defaultTone(), ...settings };
    const response = TONE_GLOBAL_RESPONSE;
    const name = (key: string) => `u_${prefix}${prefix ? key[0].toUpperCase() + key.slice(1) : key}`;
    uniforms.set1f(name("temperature"), value.temperature / response.valueScale);
    uniforms.set1f(name("tint"), value.tint / response.valueScale);
    uniforms.set1f(name("exposure"), Math.pow(2, value.exposure / response.exposureScale));
    uniforms.set1f(name("contrast"), Math.max(0, 1 + value.contrast / response.contrastScale));
    uniforms.set1f(name("saturation"), Math.max(0, 1 + value.saturation / response.saturationScale));
    uniforms.set1f(name("blacks"), value.blacks / response.valueScale);
    uniforms.set1f(name("shadows"), value.shadows / response.valueScale);
    uniforms.set1f(name("highlights"), value.highlights / response.valueScale);
    uniforms.set1f(name("whites"), value.whites / response.valueScale);
  }
}

import type { EffectLayers } from "../effect";
import { ShaderEffect, type EffectUniforms } from "../shader-effect";
import { defaultSharpen, isSharpenZero, type SharpenSettings } from "./sharpen-settings";
import { sharpenShader } from "./sharpen-shader";

export class SharpenEffect extends ShaderEffect<SharpenSettings> {
  readonly id = "sharpen";
  readonly shader = sharpenShader;

  defaults(): SharpenSettings {
    return defaultSharpen();
  }

  isNeutral(settings: SharpenSettings | null | undefined): boolean {
    return isSharpenZero(settings);
  }

  bind(uniforms: EffectUniforms, layers: EffectLayers<SharpenSettings>): void {
    const photoEnabled = this.bindLayer(uniforms, "edit", layers.photo);
    const postEnabled = this.bindLayer(uniforms, "post", layers.post);
    const enabled = photoEnabled || postEnabled;
    uniforms.set2f(
      "u_sharpenStep",
      enabled ? uniforms.sourceScaleX / uniforms.outputWidth : 0,
      enabled ? uniforms.sourceScaleY / uniforms.outputHeight : 0,
    );
  }

  private bindLayer(uniforms: EffectUniforms, prefix: "edit" | "post", settings: SharpenSettings | null): boolean {
    const enabled = !!settings && settings.strength > 0;
    uniforms.set1f(`u_${prefix}SharpenStrength`, enabled ? settings.strength : 0);
    uniforms.set1f(`u_${prefix}SharpenRadius`, enabled ? Math.max(settings.radius, 0.3) : 1);
    uniforms.set1f(`u_${prefix}SharpenThreshold`, enabled ? settings.threshold : 0);
    return enabled;
  }
}

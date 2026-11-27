import type { EffectLayers } from "../effect";
import { ShaderEffect, type EffectUniforms } from "../shader-effect";
import { COLOR_SLIDER_RESPONSE } from "./color-response";
import { COLOR_CHANNELS, defaultColor, isColorZero, type ColorEdit } from "./color-settings";
import { colorShader } from "./color-shader";

export class ColorEffect extends ShaderEffect<ColorEdit> {
  readonly id = "color";
  readonly shader = colorShader;

  defaults(): ColorEdit {
    return defaultColor();
  }

  isNeutral(settings: ColorEdit | null | undefined): boolean {
    return isColorZero(settings);
  }

  bind(uniforms: EffectUniforms, layers: EffectLayers<ColorEdit>): void {
    this.bindLayer(uniforms, "edit", layers.photo);
    this.bindLayer(uniforms, "post", layers.post);
  }

  private bindLayer(uniforms: EffectUniforms, prefix: "edit" | "post", settings: ColorEdit | null): void {
    const value = settings ?? defaultColor();
    const scale = COLOR_SLIDER_RESPONSE.valueScale;
    uniforms.set1i(`u_${prefix}ColorEnabled`, isColorZero(value) ? 0 : 1);
    uniforms.set1i(`u_${prefix}BlackAndWhite`, value.blackAndWhite ? 1 : 0);
    const channels = new Float32Array(COLOR_CHANNELS.length * 3);
    COLOR_CHANNELS.forEach((key, index) => {
      channels[index * 3] = value.channels[key].hue / scale;
      channels[index * 3 + 1] = value.channels[key].saturation / scale;
      channels[index * 3 + 2] = value.channels[key].luminance / scale;
    });
    uniforms.set3fv(`u_${prefix}ColorChannels[0]`, channels);
    uniforms.set3f(`u_${prefix}ColorGlobal`, value.hue / scale, value.saturation / scale, value.luminance / scale);
  }
}

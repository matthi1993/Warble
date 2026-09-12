import type { ToolShaderModule } from "../../rendering/shader-types";
import { glslFloat } from "../../rendering/glsl";
import {
  defaultTone,
  isToneZero,
  TONE_GLOBAL_RESPONSE,
  TONE_REGION_FALLOFFS,
  type ToneEdit,
} from "@domain/edits";

function bindTone(
  set: (name: string, value: number) => void,
  prefix: "" | "post",
  input: unknown,
): void {
  const value = { ...defaultTone(), ...(input as Partial<ToneEdit> | null) };
  const name = (key: string) => `u_${prefix}${prefix ? key[0].toUpperCase() + key.slice(1) : key}`;
  set(name("temperature"), value.temperature / TONE_GLOBAL_RESPONSE.valueScale);
  set(name("tint"), value.tint / TONE_GLOBAL_RESPONSE.valueScale);
  set(name("exposure"), Math.pow(2, value.exposure / TONE_GLOBAL_RESPONSE.exposureScale));
  set(name("contrast"), Math.max(0, 1 + value.contrast / TONE_GLOBAL_RESPONSE.contrastScale));
  set(name("saturation"), Math.max(0, 1 + value.saturation / TONE_GLOBAL_RESPONSE.saturationScale));
  set(name("blacks"), value.blacks / TONE_GLOBAL_RESPONSE.valueScale);
  set(name("shadows"), value.shadows / TONE_GLOBAL_RESPONSE.valueScale);
  set(name("highlights"), value.highlights / TONE_GLOBAL_RESPONSE.valueScale);
  set(name("whites"), value.whites / TONE_GLOBAL_RESPONSE.valueScale);
}

export const toneShader: ToolShaderModule = {
  id: "tone",
  declarations: `
    uniform float u_temperature;
    uniform float u_tint;
    uniform float u_exposure;
    uniform float u_contrast;
    uniform float u_saturation;
    uniform float u_blacks;
    uniform float u_shadows;
    uniform float u_highlights;
    uniform float u_whites;
    uniform float u_postTemperature;
    uniform float u_postTint;
    uniform float u_postExposure;
    uniform float u_postContrast;
    uniform float u_postSaturation;
    uniform float u_postBlacks;
    uniform float u_postShadows;
    uniform float u_postHighlights;
    uniform float u_postWhites;
  `,
  functions: `
    float toolLinearToSrgbTone(float c) {
      if (c <= 0.0031308) return c * 12.92;
      return 1.055 * pow(max(c, 0.0), 1.0 / 2.4) - 0.055;
    }

    float toolSrgbToLinearTone(float c) {
      if (c <= 0.04045) return c / 12.92;
      return pow((c + 0.055) / 1.055, 2.4);
    }

    vec3 toolApplyTone(
      vec3 col,
      float temperature,
      float tint,
      float exposure,
      float contrast,
      float saturation,
      float blacks,
      float shadows,
      float highlights,
      float whites,
      int linearSource
    ) {
      col *= exposure;
      float tempGain = temperature * ${glslFloat(TONE_GLOBAL_RESPONSE.temperatureGain)};
      col.r *= 1.0 + tempGain;
      col.b *= 1.0 - tempGain;
      float tintGain = tint * ${glslFloat(TONE_GLOBAL_RESPONSE.tintGain)};
      col.g *= 1.0 + tintGain;
      col.r *= 1.0 - tintGain * 0.5;
      col.b *= 1.0 - tintGain * 0.5;
      col = max(col, vec3(0.0));

      float regionalAmount = abs(blacks) + abs(shadows)
        + abs(highlights) + abs(whites);
      if (regionalAmount > 1e-6) {
        float workingLuma = max(dot(col, LUMA), 0.0);
        float toneLuma = linearSource == 1
          ? toolLinearToSrgbTone(workingLuma)
          : workingLuma;
        float bandLuma = clamp(toneLuma, 0.0, 1.0);
        float wBlacks = 1.0 - smoothstep(
          ${glslFloat(TONE_REGION_FALLOFFS.blacks.start)},
          ${glslFloat(TONE_REGION_FALLOFFS.blacks.end)},
          bandLuma
        );
        float wShadows = 1.0 - smoothstep(
          ${glslFloat(TONE_REGION_FALLOFFS.shadows.start)},
          ${glslFloat(TONE_REGION_FALLOFFS.shadows.end)},
          bandLuma
        );
        float wHighlights = smoothstep(
          ${glslFloat(TONE_REGION_FALLOFFS.highlights.start)},
          ${glslFloat(TONE_REGION_FALLOFFS.highlights.end)},
          bandLuma
        );
        float wWhites = smoothstep(
          ${glslFloat(TONE_REGION_FALLOFFS.whites.start)},
          ${glslFloat(TONE_REGION_FALLOFFS.whites.end)},
          bandLuma
        );
        float toneOffset =
            blacks * ${glslFloat(TONE_REGION_FALLOFFS.blacks.strength)} * wBlacks
          + shadows * ${glslFloat(TONE_REGION_FALLOFFS.shadows.strength)} * wShadows
          + highlights * ${glslFloat(TONE_REGION_FALLOFFS.highlights.strength)} * wHighlights
          + whites * ${glslFloat(TONE_REGION_FALLOFFS.whites.strength)} * wWhites;
        float targetToneLuma = max(toneLuma + toneOffset, 0.0);
        float targetWorkingLuma = linearSource == 1
          ? toolSrgbToLinearTone(targetToneLuma)
          : targetToneLuma;
        if (workingLuma > 1e-6) col *= targetWorkingLuma / workingLuma;
      }
      col = (col - 0.5) * contrast + 0.5;
      float luma = dot(col, LUMA);
      return mix(vec3(luma), col, saturation);
    }
  `,
  photoApply: `
    color = toolApplyTone(
      source, u_temperature, u_tint, u_exposure, u_contrast,
      u_saturation, u_blacks, u_shadows, u_highlights, u_whites,
      u_rawSource
    );
  `,
  postApply: `
    color = toolApplyTone(
      color, u_postTemperature, u_postTint, u_postExposure, u_postContrast,
      u_postSaturation, u_postBlacks, u_postShadows, u_postHighlights,
      u_postWhites, u_rawSource
    );
  `,
  bind(context, photoValue, postValue) {
    bindTone(context.set1f, "", photoValue);
    bindTone(context.set1f, "post", postValue);
  },
  isActive(value) {
    return !isToneZero(value as ToneEdit | null);
  },
};

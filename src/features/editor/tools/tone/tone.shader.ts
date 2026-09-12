import type { ToolShaderModule } from "../../rendering/shader-types";
import { defaultTone, isToneZero, type ToneEdit } from "@domain/edits";

function bindTone(
  set: (name: string, value: number) => void,
  prefix: "" | "post",
  input: unknown,
): void {
  const value = { ...defaultTone(), ...(input as Partial<ToneEdit> | null) };
  const name = (key: string) => `u_${prefix}${prefix ? key[0].toUpperCase() + key.slice(1) : key}`;
  set(name("temperature"), value.temperature / 100);
  set(name("tint"), value.tint / 100);
  set(name("exposure"), Math.pow(2, value.exposure / 100));
  set(name("contrast"), Math.max(0, 1 + value.contrast / 200));
  set(name("saturation"), Math.max(0, 1 + value.saturation / 100));
  set(name("blacks"), value.blacks / 100);
  set(name("shadows"), value.shadows / 100);
  set(name("highlights"), value.highlights / 100);
  set(name("whites"), value.whites / 100);
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
      float tempGain = temperature * 0.30;
      col.r *= 1.0 + tempGain;
      col.b *= 1.0 - tempGain;
      float tintGain = tint * 0.20;
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
        float wBlacks = smoothstep(0.0, 0.07, bandLuma)
          * (1.0 - smoothstep(0.20, 0.40, bandLuma));
        float wShadows = smoothstep(0.015, 0.16, bandLuma)
          * (1.0 - smoothstep(0.48, 0.70, bandLuma));
        float wHighlights = smoothstep(0.30, 0.52, bandLuma)
          * (1.0 - smoothstep(0.88, 1.0, bandLuma));
        float wWhites = smoothstep(0.64, 0.90, bandLuma);
        float toneOffset =
            blacks * 0.12 * wBlacks
          + shadows * 0.22 * wShadows
          + highlights * 0.22 * wHighlights
          + whites * 0.16 * wWhites;
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

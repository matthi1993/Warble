import type { ToolShaderModule, ToolShaderBindingContext } from "../../rendering/shader-types";
import { defaultBloom, type BloomSettings } from "@domain/edits";

function bindBloom(context: ToolShaderBindingContext, input: unknown): void {
  const value = input as BloomSettings | null;
  const defaults = defaultBloom();
  context.set1f("u_bloomStrength", value?.strength ?? 0);
  context.set1f("u_bloomThreshold", (value?.threshold ?? defaults.threshold) / 100);
  context.set1f("u_bloomRadius", value?.radius ?? defaults.radius);
  context.set1f("u_bloomSoftness", (value?.softness ?? defaults.softness) / 100);
  context.set1f("u_bloomSpread", (value?.spread ?? defaults.spread) / 100);
  context.set2f("u_bloomStep", context.sourceScaleX / context.outputWidth, context.sourceScaleY / context.outputHeight);
}

export const bloomShader: ToolShaderModule = {
  id: "bloom",
  declarations: `
    uniform float u_bloomStrength;
    uniform float u_bloomThreshold;
    uniform float u_bloomRadius;
    uniform float u_bloomSoftness;
    uniform float u_bloomSpread;
    uniform vec2 u_bloomStep;
  `,
  functions: `
    vec3 bloomSource(vec2 uv, float lod) {
      return srgbToLinear(textureLod(u_tex, uv, lod).rgb);
    }

    vec3 bloomBright(vec3 sampleColor, float lod) {
      float luminance = dot(max(sampleColor, vec3(0.0)), LUMA);
      float lodMix = clamp(lod * 0.2, 0.0, 1.0);
      float threshold = mix(u_bloomThreshold, u_bloomThreshold * 0.38, lodMix);
      float edge = mix(0.025, 0.32, u_bloomSoftness);
      float gate = smoothstep(threshold - edge, threshold + edge, luminance);
      float energy = smoothstep(threshold - edge, 1.0, luminance);
      return sampleColor * gate * mix(0.55, 1.0, energy);
    }

    vec3 bloomDiffusion(float radiusPixels) {
      float lod = clamp(log2(max(radiusPixels * 0.45, 1.0)), 0.0, 5.0);
      vec2 outer = u_bloomStep * radiusPixels;
      vec2 inner = outer * 0.42;
      vec2 diagonal = outer * 0.62;
      vec3 result = bloomBright(bloomSource(v_uv, lod), lod) * 0.16;
      result += bloomBright(bloomSource(v_uv + vec2(inner.x, 0.0), lod), lod) * 0.12;
      result += bloomBright(bloomSource(v_uv - vec2(inner.x, 0.0), lod), lod) * 0.12;
      result += bloomBright(bloomSource(v_uv + vec2(0.0, inner.y), lod), lod) * 0.12;
      result += bloomBright(bloomSource(v_uv - vec2(0.0, inner.y), lod), lod) * 0.12;
      result += bloomBright(bloomSource(v_uv + diagonal, lod), lod) * 0.06;
      result += bloomBright(bloomSource(v_uv - diagonal, lod), lod) * 0.06;
      result += bloomBright(bloomSource(v_uv + vec2(diagonal.x, -diagonal.y), lod), lod) * 0.06;
      result += bloomBright(bloomSource(v_uv + vec2(-diagonal.x, diagonal.y), lod), lod) * 0.06;
      result += bloomBright(bloomSource(v_uv + vec2(outer.x, 0.0), lod), lod) * 0.03;
      result += bloomBright(bloomSource(v_uv - vec2(outer.x, 0.0), lod), lod) * 0.03;
      result += bloomBright(bloomSource(v_uv + vec2(0.0, outer.y), lod), lod) * 0.03;
      result += bloomBright(bloomSource(v_uv - vec2(0.0, outer.y), lod), lod) * 0.03;
      return result;
    }

    vec3 toolApplyBloom(vec3 current) {
      vec3 currentLinear = srgbToLinear(current);
      float baseRadius = 2.0 + pow(u_bloomRadius * 0.01, 1.35) * 70.0;
      vec3 tight = bloomDiffusion(baseRadius * 0.35);
      vec3 medium = bloomDiffusion(baseRadius);
      vec3 wide = bloomDiffusion(baseRadius * 3.0);
      float tightWeight = mix(0.62, 0.18, u_bloomSpread);
      float wideWeight = mix(0.08, 0.52, u_bloomSpread);
      vec3 glow = tight * tightWeight + medium * 0.30 + wide * wideWeight;
      float currentLuma = dot(max(currentLinear, vec3(0.0)), LUMA);
      float darkness = 1.0 - smoothstep(0.04, 0.78, currentLuma);
      darkness = pow(darkness, mix(0.75, 1.35, u_bloomSoftness));
      float thresholdEdge = mix(0.04, 0.30, u_bloomSoftness);
      float highlightRejection = 1.0 - smoothstep(
        u_bloomThreshold - thresholdEdge,
        u_bloomThreshold + thresholdEdge,
        currentLuma
      );
      float receiverMask = darkness * highlightRejection;
      vec3 bloomed = currentLinear
        + glow * (u_bloomStrength * 0.008) * receiverMask;
      return linearToSrgb(bloomed);
    }
  `,
  photoApply: "",
  postApply: `if (u_bloomStrength > 0.0) color = toolApplyBloom(color);`,
  bind(context, _photoValue, postValue) { bindBloom(context, postValue); },
  isActive(value) { return ((value as { strength?: number } | null)?.strength ?? 0) > 0; },
};

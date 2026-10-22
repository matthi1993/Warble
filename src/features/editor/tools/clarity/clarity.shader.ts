import { defaultClarity, isClarityZero, type ClaritySettings } from "@domain/edits";
import type { ToolShaderBindingContext, ToolShaderModule } from "../../rendering/shader-types";

function bindClarity(context: ToolShaderBindingContext, prefix: "edit" | "post", input: unknown): void {
  const value = { ...defaultClarity(), ...(input as ClaritySettings | null) };
  context.set1f(`u_${prefix}Clarity`, value.clarity / 100);
  context.set1f(`u_${prefix}Structure`, value.structure / 100);
}

function applyClarity(prefix: "edit" | "post"): string {
  return `
    if (u_${prefix}Clarity != 0.0 || u_${prefix}Structure != 0.0) {
      color = toolApplyClarity(color, u_${prefix}Clarity, u_${prefix}Structure);
    }
  `;
}

export const clarityShader: ToolShaderModule = {
  id: "clarity",
  declarations: `
    uniform float u_editClarity;
    uniform float u_editStructure;
    uniform float u_postClarity;
    uniform float u_postStructure;
    uniform vec2 u_clarityStep;
  `,
  functions: `
    float clarityLocalLuma(float radius) {
      vec2 offset = u_clarityStep * radius * 0.7;
      vec2 sourceRadius = u_clarityStep * radius * u_sourceSize;
      float lod = max(log2(max(max(sourceRadius.x, sourceRadius.y) * 0.5, 1.0)), 0.0);
      vec3 mean = textureLod(u_tex, v_uv, lod).rgb * 0.2;
      mean += textureLod(u_tex, v_uv + offset, lod).rgb * 0.2;
      mean += textureLod(u_tex, v_uv - offset, lod).rgb * 0.2;
      mean += textureLod(u_tex, v_uv + vec2(offset.x, -offset.y), lod).rgb * 0.2;
      mean += textureLod(u_tex, v_uv + vec2(-offset.x, offset.y), lod).rgb * 0.2;
      return dot(mean, LUMA);
    }

    float clarityDetail(float difference, float haloProtection, float noiseProtection) {
      float noiseFloor = noiseProtection * 0.025;
      float noiseGate = smoothstep(noiseFloor * 0.35, noiseFloor + 0.0001, abs(difference));
      return difference * noiseGate / (1.0 + abs(difference) * haloProtection * 24.0);
    }

    vec3 clarityBlend(vec3 current, float delta) {
      float luma = dot(current, LUMA);
      float midtones = smoothstep(0.01, 0.16, luma) * (1.0 - smoothstep(0.75, 1.0, luma));
      float darkest = min(current.r, min(current.g, current.b));
      float lightest = max(current.r, max(current.g, current.b));
      float protectedDelta = clamp(delta * midtones, -max(darkest, 0.0), max(1.0 - lightest, 0.0));
      return current + vec3(protectedDelta);
    }

    vec3 toolApplyClarity(vec3 current, float clarity, float structure) {
      float sourceLuma = dot(sampleSource(v_uv), LUMA);
      float delta = 0.0;
      if (clarity != 0.0) {
        float broadDetail = sourceLuma - clarityLocalLuma(24.0);
        delta += clarityDetail(broadDetail, 0.6, 0.1) * clarity * 1.4;
      }
      if (structure != 0.0) {
        float fineDetail = sourceLuma - clarityLocalLuma(2.4);
        delta += clarityDetail(fineDetail, 0.6, 0.2) * structure;
      }
      return clarityBlend(current, delta);
    }
  `,
  photoApply: applyClarity("edit"),
  postApply: applyClarity("post"),
  bind(context, photoValue, postValue) {
    bindClarity(context, "edit", photoValue);
    bindClarity(context, "post", postValue);
    context.set2f("u_clarityStep", context.sourceScaleX / context.outputWidth, context.sourceScaleY / context.outputHeight);
  },
  isActive(value) { return !isClarityZero(value as ClaritySettings | null); },
};

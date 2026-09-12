import type { ToolShaderModule } from "../../rendering/shader-types";
import type { SharpenSettings } from "@services/effects/effects-store";

function bindSharpen(
  prefix: "edit" | "post",
  input: unknown,
  set: (name: string, value: number) => void,
): boolean {
  const value = input as SharpenSettings | null;
  const enabled = !!value && value.strength > 0;
  set(`u_${prefix}SharpenStrength`, enabled ? value.strength : 0);
  set(`u_${prefix}SharpenRadius`, enabled ? Math.max(value.radius, 0.3) : 1);
  set(`u_${prefix}SharpenThreshold`, enabled ? value.threshold : 0);
  return enabled;
}

export const sharpenShader: ToolShaderModule = {
  id: "sharpen",
  declarations: `
    uniform float u_editSharpenStrength;
    uniform float u_editSharpenRadius;
    uniform float u_editSharpenThreshold;
    uniform float u_postSharpenStrength;
    uniform float u_postSharpenRadius;
    uniform float u_postSharpenThreshold;
    uniform vec2 u_sharpenStep;
  `,
  functions: `
    vec3 toolUnsharpDetail(float radius, float threshold) {
      vec3 src = sampleSource(v_uv);
      vec2 radiusStep = u_sharpenStep * radius;
      vec3 blurred = src * 0.5
        + sampleSource(v_uv + vec2(radiusStep.x, radiusStep.y)) * 0.125
        + sampleSource(v_uv + vec2(-radiusStep.x, radiusStep.y)) * 0.125
        + sampleSource(v_uv + vec2(radiusStep.x, -radiusStep.y)) * 0.125
        + sampleSource(v_uv + vec2(-radiusStep.x, -radiusStep.y)) * 0.125;
      vec3 detail = src - blurred;
      float lumDelta = abs(dot(detail, LUMA));
      float threshold01 = threshold / 255.0;
      float gate = threshold <= 0.0
        ? 1.0
        : smoothstep(threshold01 * 0.5, threshold01 + 1e-4, lumDelta);
      return detail * gate;
    }
  `,
  photoApply: `
    if (u_editSharpenStrength > 0.0) {
      color += toolUnsharpDetail(u_editSharpenRadius, u_editSharpenThreshold)
        * (u_editSharpenStrength * 0.01);
    }
  `,
  postApply: `
    if (u_postSharpenStrength > 0.0) {
      color += toolUnsharpDetail(u_postSharpenRadius, u_postSharpenThreshold)
        * (u_postSharpenStrength * 0.01);
    }
  `,
  bind(context, photoValue, postValue) {
    const photoEnabled = bindSharpen("edit", photoValue, context.set1f);
    const postEnabled = bindSharpen("post", postValue, context.set1f);
    const enabled = photoEnabled || postEnabled;
    context.set2f(
      "u_sharpenStep",
      enabled ? context.sourceScaleX / context.outputWidth : 0,
      enabled ? context.sourceScaleY / context.outputHeight : 0,
    );
  },
  isActive(value) {
    return ((value as SharpenSettings | null)?.strength ?? 0) > 0;
  },
};

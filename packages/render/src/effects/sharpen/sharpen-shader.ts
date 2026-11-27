import type { EffectShader } from "../shader-effect";

export const sharpenShader: EffectShader = {
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
};

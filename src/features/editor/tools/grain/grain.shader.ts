import type { ToolShaderModule } from "../../rendering/shader-types";
import type { GrainSettings } from "@domain/edits";

function bindGrain(
  prefix: "edit" | "",
  input: unknown,
  set: (name: string, value: number) => void,
): void {
  const value = input as GrainSettings | null;
  const name = (key: string) => `u_${prefix}${prefix ? key[0].toUpperCase() + key.slice(1) : key}`;
  set(name("grainSize"), value?.size ?? 25);
  set(name("grainAmount"), value?.amount ?? 0);
  set(name("grainFine"), value?.fine ?? 0);
}

export const GRAIN_TEXTURE_SIZE = 1024;

export const grainShader: ToolShaderModule = {
  id: "grain",
  declarations: `
    uniform sampler2D u_grainTexture;
    uniform float u_grainSize;
    uniform float u_grainAmount;
    uniform float u_grainFine;
    uniform float u_editGrainSize;
    uniform float u_editGrainAmount;
    uniform float u_editGrainFine;
  `,
  functions: `
    float toolOrganicGrain(float grainSize) {
      float shortEdge = max(min(u_sourceSize.x, u_sourceSize.y), 1.0);
      vec2 imageAspect = u_sourceSize / shortEdge;
      float fineScale = 1.0 / min(max(grainSize, 0.1), 1.0);
      vec2 p = v_uv * imageAspect * fineScale;
      float size01 = clamp((grainSize - 1.0) / 99.0, 0.0, 1.0);
      float lod = mix(0.0, 4.0, size01);
      float blurScale = exp2(lod);
      float a = textureGrad(
        u_grainTexture, p + vec2(0.173, 0.417),
        dFdx(p) * blurScale, dFdy(p) * blurScale
      ).r - 0.5;
      vec2 q = mat2(0.819, -0.574, 0.574, 0.819) * p;
      float b = textureGrad(
        u_grainTexture, q + vec2(0.619, 0.271),
        dFdx(q) * blurScale, dFdy(q) * blurScale
      ).g - 0.5;
      return (a * 0.82 + b * 0.58) * blurScale * 1.35;
    }

    float toolFineGrain() {
      vec2 sourcePixel = floor(v_uv * u_sourceSize);
      vec2 uv = (mod(sourcePixel, 1024.0) + 0.5) / 1024.0;
      vec2 dx = dFdx(v_uv) * u_sourceSize / 1024.0;
      vec2 dy = dFdy(v_uv) * u_sourceSize / 1024.0;
      return textureGrad(u_grainTexture, uv, dx, dy).b * 2.0 - 1.0;
    }

    vec3 toolApplyGrain(vec3 col, float size, float amount, float fine) {
      float luma = clamp(dot(col, LUMA), 0.0, 1.0);
      float midtone = sqrt(max(4.0 * luma * (1.0 - luma), 0.0));
      float tonalMask = mix(0.35, 1.0, midtone);
      float noise = 0.0;
      if (amount > 0.0) noise += toolOrganicGrain(size) * (amount * 0.0035);
      if (fine > 0.0) noise += toolFineGrain() * (fine * 0.00055);
      return col + vec3(noise * tonalMask);
    }
  `,
  photoApply: `
    if (u_editGrainAmount > 0.0 || u_editGrainFine > 0.0) {
      color = toolApplyGrain(
        color, u_editGrainSize, u_editGrainAmount, u_editGrainFine
      );
    }
  `,
  postApply: `
    if (u_grainAmount > 0.0 || u_grainFine > 0.0) {
      color = toolApplyGrain(color, u_grainSize, u_grainAmount, u_grainFine);
    }
  `,
  bind(context, photoValue, postValue) {
    bindGrain("edit", photoValue, context.set1f);
    bindGrain("", postValue, context.set1f);
  },
  isActive(value) {
    const grain = value as GrainSettings | null;
    return (grain?.amount ?? 0) > 0 || (grain?.fine ?? 0) > 0;
  },
};

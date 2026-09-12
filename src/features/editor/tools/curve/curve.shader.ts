import type { ToolShaderModule } from "../../rendering/shader-types";
import { isCurveZero, type CurveEdit } from "@domain/edits";

export const curveShader: ToolShaderModule = {
  id: "curve",
  declarations: `
    uniform sampler2D u_editLut;
    uniform sampler2D u_postLut;
    uniform int u_editLutEnabled;
    uniform int u_postLutEnabled;
  `,
  functions: `
    vec3 toolApplyCurveLut(vec3 col, sampler2D lut) {
      vec3 cc = clamp(col, 0.0, 1.0);
      vec3 u = cc * (255.0 / 256.0) + vec3(0.5 / 256.0);
      float row0 = 0.25;
      float row1 = 0.75;
      float r = texture(lut, vec2(u.r, row0)).r;
      float g = texture(lut, vec2(u.g, row0)).g;
      float b = texture(lut, vec2(u.b, row0)).b;
      vec3 combinedU = vec3(r, g, b) * (255.0 / 256.0)
        + vec3(0.5 / 256.0);
      r = texture(lut, vec2(combinedU.r, row0)).a;
      g = texture(lut, vec2(combinedU.g, row0)).a;
      b = texture(lut, vec2(combinedU.b, row0)).a;
      vec3 result = vec3(r, g, b);
      float luma = clamp(dot(result, LUMA), 0.0, 1.0);
      float lumaU = luma * (255.0 / 256.0) + (0.5 / 256.0);
      float mappedLuma = texture(lut, vec2(lumaU, row1)).r;
      return result + vec3(mappedLuma - luma);
    }
  `,
  photoApply: `
    if (u_editLutEnabled == 1) color = toolApplyCurveLut(color, u_editLut);
  `,
  postApply: `
    if (u_postLutEnabled == 1) color = toolApplyCurveLut(color, u_postLut);
  `,
  bind(context, photoValue, postValue) {
    context.bindCurve("photo", photoValue);
    context.bindCurve("post", postValue);
  },
  isActive(value) {
    return !isCurveZero(value as CurveEdit | null);
  },
};

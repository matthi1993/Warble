import { isAnalogZero, type AnalogSettings } from "@domain/edits";
import type { ToolShaderModule } from "../../rendering/shader-types";

export const analogShader: ToolShaderModule = {
  id: "analog",
  declarations: "",
  functions: "",
  photoApply: "",
  postApply: "",
  bind() {},
  isActive(value) { return !isAnalogZero(value as AnalogSettings | null); },
};

export const ANALOG_VERTEX_SHADER = `#version 300 es
  layout(location = 0) in vec2 a_pos;
  out vec2 v_uv;
  void main() {
    v_uv = a_pos * 0.5 + 0.5;
    gl_Position = vec4(a_pos.x, -a_pos.y, 0.0, 1.0);
  }
`;

export const ANALOG_FRAGMENT_SHADER = `#version 300 es
  precision highp float;
  precision highp int;
  uniform sampler2D u_edited;
  uniform vec2 u_srcOffset;
  uniform vec2 u_srcScale;
  uniform vec2 u_photoAspect;
  uniform vec2 u_inputSize;
  uniform bool u_monochrome;
  uniform float u_vignette;
  uniform float u_halation;
  uniform float u_chromaticAberration;
  in vec2 v_uv;
  out vec4 outColor;
  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

  vec3 analogSampleLod(vec2 photoUv, float lod) {
    vec2 viewUv = (photoUv - u_srcOffset) / u_srcScale;
    return textureLod(u_edited, vec2(viewUv.x, 1.0 - viewUv.y), lod).rgb;
  }

  float analogBlurLod(vec2 radius) {
    vec2 pixels = radius / u_srcScale * u_inputSize;
    return max(log2(max(max(pixels.x, pixels.y) * 0.5, 1.0)), 0.0);
  }

  float analogEdgeMask(vec2 photoUv) {
    float radius = length((photoUv - 0.5) * 1.41421356);
    return smoothstep(0.2, 0.95, radius);
  }

  vec3 analogLensSample(vec2 photoUv) {
    vec3 color = analogSampleLod(photoUv, 0.0);
    if (u_chromaticAberration > 0.0) {
      vec2 centered = photoUv - 0.5;
      vec2 shift = centered * dot(centered, centered) * u_chromaticAberration * 0.035;
      color.r = analogSampleLod(photoUv + shift, 0.0).r;
      color.b = analogSampleLod(photoUv - shift, 0.0).b;
    }
    return color;
  }

  float analogHighlight(vec2 photoUv, float lod) {
    float luma = dot(analogSampleLod(photoUv, lod), LUMA);
    return luma * smoothstep(0.65, 0.95, luma);
  }

  vec3 analogHalation(vec3 color, vec2 photoUv) {
    vec2 radius = vec2(0.004 + u_halation * 0.008) / u_photoAspect;
    float lod = analogBlurLod(radius);
    float glow = 0.0;
    for (int index = 0; index < 8; index++) {
      float angle = float(index) * 0.78539816;
      vec2 direction = vec2(cos(angle), sin(angle));
      glow += analogHighlight(photoUv + direction * radius, lod) * 0.075;
      glow += analogHighlight(photoUv + direction * radius * 0.4, max(lod - 1.0, 0.0)) * 0.05;
    }
    float receiver = 1.0 - smoothstep(0.25, 0.9, dot(color, LUMA));
    vec3 tint = u_monochrome ? vec3(0.4) : vec3(1.0, 0.18, 0.035);
    return color + glow * receiver * u_halation * tint * 0.7;
  }

  void main() {
    vec2 photoUv = u_srcOffset + v_uv * u_srcScale;
    float edge = analogEdgeMask(photoUv);
    vec3 color = analogLensSample(photoUv);
    if (u_halation > 0.0) color = analogHalation(color, photoUv);
    color *= exp2(-u_vignette * edge * edge * 2.5);
    if (u_monochrome) color = vec3(dot(color, LUMA));
    outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
`;

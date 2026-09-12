import type { ToolShaderModule } from "../../rendering/shader-types";
import { glslFloat } from "../../rendering/glsl";
import {
  COLOR_CHANNELS,
  COLOR_HUE_FALLOFF,
  COLOR_SLIDER_RESPONSE,
  defaultColor,
  isColorZero,
  type ColorEdit,
} from "@domain/edits";

function bindColor(
  prefix: "edit" | "post",
  input: unknown,
  set1i: (name: string, value: number) => void,
  set3f: (name: string, x: number, y: number, z: number) => void,
  set3fv: (name: string, value: Float32Array) => void,
): void {
  const value = (input as ColorEdit | null) ?? defaultColor();
  set1i(`u_${prefix}ColorEnabled`, isColorZero(value) ? 0 : 1);
  set1i(`u_${prefix}BlackAndWhite`, value.blackAndWhite ? 1 : 0);
  const channels = new Float32Array(COLOR_CHANNELS.length * 3);
  COLOR_CHANNELS.forEach((key, index) => {
    channels[index * 3] = value.channels[key].hue / COLOR_SLIDER_RESPONSE.valueScale;
    channels[index * 3 + 1] = value.channels[key].saturation / COLOR_SLIDER_RESPONSE.valueScale;
    channels[index * 3 + 2] = value.channels[key].luminance / COLOR_SLIDER_RESPONSE.valueScale;
  });
  set3fv(`u_${prefix}ColorChannels[0]`, channels);
  set3f(
    `u_${prefix}ColorGlobal`,
    value.hue / COLOR_SLIDER_RESPONSE.valueScale,
    value.saturation / COLOR_SLIDER_RESPONSE.valueScale,
    value.luminance / COLOR_SLIDER_RESPONSE.valueScale,
  );
}

export const colorShader: ToolShaderModule = {
  id: "color",
  declarations: `
    uniform int u_editColorEnabled;
    uniform vec3 u_editColorChannels[8];
    uniform vec3 u_editColorGlobal;
    uniform int u_editBlackAndWhite;
    uniform int u_postColorEnabled;
    uniform vec3 u_postColorChannels[8];
    uniform vec3 u_postColorGlobal;
    uniform int u_postBlackAndWhite;
  `,
  functions: `
    vec3 toolRgb2hsv(vec3 c) {
      vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
      vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
      vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
      float d = q.x - min(q.w, q.y);
      float e = 1.0e-10;
      return vec3(abs(q.z + (q.w - q.y) / (6.0*d + e)), d/(q.x + e), q.x);
    }

    vec3 toolHsv2rgb(vec3 c) {
      vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
      vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
      return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
    }

    vec3 toolApplyColor(vec3 rgb, vec3 channels[8], vec3 globalShift) {
      float centres[8];
      centres[0] = 0.0;
      centres[1] = 30.0/360.0;
      centres[2] = 60.0/360.0;
      centres[3] = 120.0/360.0;
      centres[4] = 180.0/360.0;
      centres[5] = 240.0/360.0;
      centres[6] = 270.0/360.0;
      centres[7] = 330.0/360.0;
      vec3 hsv = toolRgb2hsv(max(rgb, vec3(0.0)));
      float h = hsv.x;
      float s = hsv.y;
      float v = hsv.z;
      vec3 acc = vec3(0.0);
      float wsum = 0.0;
      for (int i = 0; i < 8; i++) {
        int prevIndex = (i + 7) % 8;
        int nextIndex = (i + 1) % 8;
        float leftSpan = mod(centres[i] - centres[prevIndex] + 1.0, 1.0);
        float rightSpan = mod(centres[nextIndex] - centres[i] + 1.0, 1.0);
        float d = mod(h - centres[i] + 0.5, 1.0) - 0.5;
        float w = 0.0;
        float rightFalloff = rightSpan * ${glslFloat(COLOR_HUE_FALLOFF)};
        float leftFalloff = leftSpan * ${glslFloat(COLOR_HUE_FALLOFF)};
        if (d >= 0.0 && d <= rightFalloff) {
          w = 1.0 - smoothstep(0.0, rightFalloff, d);
        } else if (d < 0.0 && -d <= leftFalloff) {
          w = 1.0 - smoothstep(0.0, leftFalloff, -d);
        }
        acc += channels[i] * w;
        wsum += w;
      }
      float absoluteChroma = s * v;
      float confidence = smoothstep(0.03, 0.14, s)
        * smoothstep(0.015, 0.08, absoluteChroma);
      vec3 shift = (acc / max(wsum, 1e-4)) * confidence + globalShift;
      float satGate = smoothstep(0.01, 0.06, absoluteChroma);
      float newH = fract(h + shift.x * satGate * (${glslFloat(COLOR_SLIDER_RESPONSE.hueShiftDegrees)}/360.0) + 1.0);
      float newS = clamp(s * (1.0 + shift.y * satGate), 0.0, 1.0);
      float newV = clamp(v * (1.0 + shift.z), 0.0, 1.0);
      return toolHsv2rgb(vec3(newH, newS, newV));
    }
  `,
  photoApply: `
    if (u_editColorEnabled == 1) {
      color = toolApplyColor(color, u_editColorChannels, u_editColorGlobal);
      if (u_editBlackAndWhite == 1) color = vec3(dot(color, LUMA));
    }
  `,
  postApply: `
    if (u_postColorEnabled == 1) {
      color = toolApplyColor(color, u_postColorChannels, u_postColorGlobal);
      if (u_postBlackAndWhite == 1) color = vec3(dot(color, LUMA));
    }
  `,
  bind(context, photoValue, postValue) {
    bindColor("edit", photoValue, context.set1i, context.set3f, context.set3fv);
    bindColor("post", postValue, context.set1i, context.set3f, context.set3fv);
  },
  isActive(value) {
    return !isColorZero(value as ColorEdit | null);
  },
};

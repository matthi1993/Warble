import type { EffectShader } from "../effects/shader-effect";

export class ProgramComposer {
  constructor(private readonly shaders: readonly EffectShader[]) {}

  vertexSource(): string {
    return `#version 300 es
      in vec2 a_pos;
      uniform vec2 u_srcOffset;
      uniform vec2 u_srcScale;
      out vec2 v_uv;
      void main() {
        vec2 q = a_pos * 0.5 + 0.5;
        v_uv = u_srcOffset + q * u_srcScale;
        gl_Position = vec4(a_pos.x, -a_pos.y, 0.0, 1.0);
      }
    `;
  }

  fragmentSource(): string {
    return `#version 300 es
      precision highp float;
      uniform sampler2D u_tex;
      uniform vec2 u_sourceSize;
      in vec2 v_uv;
      out vec4 outColor;
      const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

      vec3 linearToSrgb(vec3 c) {
        vec3 low = c * 12.92;
        vec3 high = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
        return mix(high, low, step(c, vec3(0.0031308)));
      }

      vec3 srgbToLinear(vec3 c) {
        vec3 low = c / 12.92;
        vec3 high = pow((max(c, vec3(0.0)) + 0.055) / 1.055, vec3(2.4));
        return mix(high, low, step(c, vec3(0.04045)));
      }

      vec3 sampleSource(vec2 uv) {
        return texture(u_tex, uv).rgb;
      }

      ${this.join((shader) => shader.declarations)}
      ${this.join((shader) => shader.functions)}

      void main() {
        vec3 color = sampleSource(v_uv);
        ${this.join((shader) => shader.sourceApply ?? "")}
        ${this.join((shader) => shader.photoApply)}
        ${this.join((shader) => shader.postApply)}
        color = clamp(color, 0.0, 1.0);
        outColor = vec4(color, 1.0);
      }
    `;
  }

  private join(part: (shader: EffectShader) => string): string {
    return this.shaders.map(part).join("\n");
  }
}

/** WebGL renderer that composes the registered tool shader modules. */
import {
  buildCurveLutTextureData,
  defaultCurve,
  isCurveZero,
  type CurveEdit,
} from "@domain/edits";
import type { RawImageSource } from "@ui/photos/canvas/raw-source";
import {
  composeToolDeclarations,
  composeToolFunctions,
  composeToolStage,
  TOOL_SHADER_MODULES,
} from "./shader-composer";
import type {
  EditorRenderValues,
  ToolShaderBindingContext,
} from "./shader-types";
import { GRAIN_TEXTURE_SIZE } from "../tools/grain/grain.shader";

export type EditorSource =
  | ImageBitmap
  | HTMLCanvasElement
  | OffscreenCanvas
  | RawImageSource;

function isRawSource(source: EditorSource): source is RawImageSource {
  return "kind" in source && source.kind === "raw16";
}

export class EditorRenderPipeline {
  readonly canvas = document.createElement("canvas");
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private sourceTexture: WebGLTexture | null = null;
  private rawTexture: WebGLTexture | null = null;
  private photoCurveTexture: WebGLTexture | null = null;
  private postCurveTexture: WebGLTexture | null = null;
  private grainTexture: WebGLTexture | null = null;
  private uploadedSource: EditorSource | null = null;
  private uploadedPhotoCurve: CurveEdit | null = null;
  private uploadedPostCurve: CurveEdit | null = null;
  private uniformLocations = new Map<string, WebGLUniformLocation | null>();
  private failed = false;

  render(
    source: EditorSource,
    values: EditorRenderValues,
    sourceRect: { sx: number; sy: number; sw: number; sh: number },
    outputWidth: number,
    outputHeight: number,
  ): HTMLCanvasElement | null {
    if (this.failed || (!this.gl && !this.initialize())) return null;
    const gl = this.gl!;
    if (this.canvas.width !== outputWidth) this.canvas.width = outputWidth;
    if (this.canvas.height !== outputHeight) this.canvas.height = outputHeight;
    if (this.uploadedSource !== source) this.uploadSource(source);

    const width = source.width;
    const height = source.height;
    const scaleX = sourceRect.sw / width;
    const scaleY = sourceRect.sh / height;

    gl.viewport(0, 0, outputWidth, outputHeight);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    this.set2f("u_srcOffset", sourceRect.sx / width, sourceRect.sy / height);
    this.set2f("u_srcScale", scaleX, scaleY);
    this.set2f("u_sourceSize", width, height);
    this.set1i("u_rawSource", isRawSource(source) ? 1 : 0);

    const bindingContext: ToolShaderBindingContext = {
      sourceScaleX: scaleX,
      sourceScaleY: scaleY,
      outputWidth,
      outputHeight,
      set1f: (name, value) => this.set1f(name, value),
      set1i: (name, value) => this.set1i(name, value),
      set2f: (name, x, y) => this.set2f(name, x, y),
      set3f: (name, x, y, z) => this.set3f(name, x, y, z),
      set3fv: (name, value) => this.set3fv(name, value),
      bindCurve: (scope, value) => this.bindCurve(scope, value),
    };
    for (const module of TOOL_SHADER_MODULES) {
      module.bind(bindingContext, values.photo[module.id], values.post[module.id]);
    }

    this.bindTexture(0, this.sourceTexture);
    this.bindTexture(1, this.photoCurveTexture);
    this.bindTexture(2, this.postCurveTexture);
    this.bindTexture(3, this.grainTexture);
    this.bindTexture(4, this.rawTexture);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return this.canvas;
  }

  warmup(source: EditorSource): void {
    if (this.failed || (!this.gl && !this.initialize())) return;
    if (this.uploadedSource !== source) this.uploadSource(source);
  }

  invalidate(): void {
    this.uploadedSource = null;
  }

  dispose(): void {
    const gl = this.gl;
    if (!gl) return;
    if (this.program) gl.deleteProgram(this.program);
    if (this.vao) gl.deleteVertexArray(this.vao);
    for (const texture of [
      this.sourceTexture,
      this.rawTexture,
      this.photoCurveTexture,
      this.postCurveTexture,
      this.grainTexture,
    ]) {
      if (texture) gl.deleteTexture(texture);
    }
    this.gl = null;
    this.program = null;
    this.vao = null;
    this.sourceTexture = null;
    this.rawTexture = null;
    this.photoCurveTexture = null;
    this.postCurveTexture = null;
    this.grainTexture = null;
    this.uploadedSource = null;
    this.uniformLocations.clear();
  }

  private initialize(): boolean {
    const gl = this.canvas.getContext("webgl2", {
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    }) as WebGL2RenderingContext | null;
    if (!gl) {
      this.failed = true;
      console.warn("WebGL2 unavailable — editing tools disabled");
      return false;
    }
    this.gl = gl;
    const vertexSource = `#version 300 es
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
    const fragmentSource = this.fragmentSource();
    const vertex = this.compile(gl.VERTEX_SHADER, vertexSource);
    const fragment = this.compile(gl.FRAGMENT_SHADER, fragmentSource);
    if (!vertex || !fragment) return this.fail();
    const program = gl.createProgram();
    if (!program) return this.fail();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("editor shader link failed:", gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return this.fail();
    }
    this.program = program;
    gl.useProgram(program);
    this.set1i("u_tex", 0);
    this.set1i("u_editLut", 1);
    this.set1i("u_postLut", 2);
    this.set1i("u_grainTexture", 3);
    this.set1i("u_rawTex", 4);
    this.createGeometry();
    this.sourceTexture = this.createSourceTexture();
    this.rawTexture = this.createRawTexture();
    this.photoCurveTexture = this.createCurveTexture();
    this.postCurveTexture = this.createCurveTexture();
    this.grainTexture = this.createGrainTexture();
    const ready = !!(
      this.vao
      && this.sourceTexture
      && this.rawTexture
      && this.photoCurveTexture
      && this.postCurveTexture
      && this.grainTexture
    );
    return ready || this.fail();
  }

  private fragmentSource(): string {
    return `#version 300 es
      precision highp float;
      precision highp usampler2D;
      uniform sampler2D u_tex;
      uniform usampler2D u_rawTex;
      uniform int u_rawSource;
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

      vec3 rawTexel(ivec2 point) {
        ivec2 size = ivec2(u_sourceSize);
        ivec2 samplePoint = clamp(point, ivec2(0), size - ivec2(1));
        return vec3(texelFetch(u_rawTex, samplePoint, 0).rgb) / 65535.0;
      }

      vec3 sampleSource(vec2 uv) {
        if (u_rawSource == 1) {
          vec2 point = clamp(uv, vec2(0.0), vec2(1.0)) * u_sourceSize - 0.5;
          ivec2 base = ivec2(floor(point));
          vec2 fraction = fract(point);
          vec3 top = mix(rawTexel(base), rawTexel(base + ivec2(1, 0)), fraction.x);
          vec3 bottom = mix(
            rawTexel(base + ivec2(0, 1)),
            rawTexel(base + ivec2(1, 1)),
            fraction.x
          );
          return mix(top, bottom, fraction.y);
        }
        return texture(u_tex, uv).rgb;
      }

      ${composeToolDeclarations()}
      ${composeToolFunctions()}

      void main() {
        vec3 source = sampleSource(v_uv);
        vec3 color = source;
        ${composeToolStage("photo")}
        ${composeToolStage("post")}
        color = clamp(color, 0.0, 1.0);
        if (u_rawSource == 1) color = linearToSrgb(color);
        outColor = vec4(color, 1.0);
      }
    `;
  }

  private bindCurve(scope: "photo" | "post", input: unknown): void {
    const value = input as CurveEdit | null;
    const enabled = !!value && !isCurveZero(value);
    const prefix = scope === "photo" ? "edit" : "post";
    this.set1i(`u_${prefix}LutEnabled`, enabled ? 1 : 0);
    if (!enabled) return;
    const previous = scope === "photo"
      ? this.uploadedPhotoCurve
      : this.uploadedPostCurve;
    if (value === previous) return;
    this.uploadCurve(
      scope === "photo" ? this.photoCurveTexture : this.postCurveTexture,
      value,
    );
    if (scope === "photo") this.uploadedPhotoCurve = value;
    else this.uploadedPostCurve = value;
  }

  private uploadSource(source: EditorSource): void {
    const gl = this.gl!;
    if (isRawSource(source)) {
      gl.bindTexture(gl.TEXTURE_2D, this.rawTexture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGB16UI, source.width, source.height, 0,
        gl.RGB_INTEGER, gl.UNSIGNED_SHORT, source.data,
      );
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.generateMipmap(gl.TEXTURE_2D);
    }
    this.uploadedSource = source;
  }

  private uploadCurve(texture: WebGLTexture | null, curve: CurveEdit): void {
    if (!texture) return;
    const gl = this.gl!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, 256, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      buildCurveLutTextureData(curve),
    );
  }

  private createGeometry(): void {
    const gl = this.gl!;
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(this.program!, "a_pos");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    this.vao = vao;
  }

  private createSourceTexture(): WebGLTexture | null {
    const gl = this.gl!;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255]),
    );
    gl.generateMipmap(gl.TEXTURE_2D);
    return texture;
  }

  private createRawTexture(): WebGLTexture | null {
    const gl = this.gl!;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGB16UI,
      1,
      1,
      0,
      gl.RGB_INTEGER,
      gl.UNSIGNED_SHORT,
      new Uint16Array([0, 0, 0]),
    );
    return texture;
  }

  private createCurveTexture(): WebGLTexture | null {
    const gl = this.gl!;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.uploadCurve(texture, defaultCurve());
    return texture;
  }

  private createGrainTexture(): WebGLTexture | null {
    const gl = this.gl!;
    const texture = gl.createTexture();
    if (!texture) return null;
    const data = new Uint8Array(GRAIN_TEXTURE_SIZE * GRAIN_TEXTURE_SIZE * 4);
    let state = ((Math.random() * 0xffffffff) >>> 0) || 0x6d2b79f5;
    const random = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };
    for (let index = 0; index < data.length; index += 4) {
      const a = random();
      const b = random();
      data[index] = ((a & 255) + ((a >>> 8) & 255) + ((a >>> 16) & 255) + ((a >>> 24) & 255)) >>> 2;
      data[index + 1] = ((b & 255) + ((b >>> 8) & 255) + ((b >>> 16) & 255) + ((b >>> 24) & 255)) >>> 2;
      data[index + 2] = (random() & 1) === 0 ? 0 : 255;
      data[index + 3] = 255;
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, GRAIN_TEXTURE_SIZE, GRAIN_TEXTURE_SIZE, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, data,
    );
    gl.generateMipmap(gl.TEXTURE_2D);
    return texture;
  }

  private bindTexture(unit: number, texture: WebGLTexture | null): void {
    const gl = this.gl!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  }

  private uniform(name: string): WebGLUniformLocation | null {
    if (!this.uniformLocations.has(name)) {
      this.uniformLocations.set(name, this.gl!.getUniformLocation(this.program!, name));
    }
    return this.uniformLocations.get(name) ?? null;
  }

  private set1f(name: string, value: number): void {
    this.gl!.uniform1f(this.uniform(name), value);
  }

  private set1i(name: string, value: number): void {
    this.gl!.uniform1i(this.uniform(name), value);
  }

  private set2f(name: string, x: number, y: number): void {
    this.gl!.uniform2f(this.uniform(name), x, y);
  }

  private set3f(name: string, x: number, y: number, z: number): void {
    this.gl!.uniform3f(this.uniform(name), x, y, z);
  }

  private set3fv(name: string, value: Float32Array): void {
    this.gl!.uniform3fv(this.uniform(name), value);
  }

  private compile(type: number, source: string): WebGLShader | null {
    const gl = this.gl!;
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("editor shader compile failed:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  private fail(): false {
    this.failed = true;
    return false;
  }
}

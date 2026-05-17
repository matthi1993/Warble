/**
 * GPU-accelerated tone pipeline.
 *
 * Renders an `ImageBitmap` (or off-screen canvas) with exposure /
 * contrast / saturation / blacks / shadows / highlights / whites
 * adjustments applied by a WebGL2 fragment shader, into an internal
 * canvas the main 2D canvas can `drawImage()` from.
 *
 * Lives outside `pf-image-canvas` so the shader code, region tables,
 * and uniform handling stay in one place and don't drown out the
 * orchestrator. The host owns lifecycle (`new TonePipeline()` on
 * construction, `dispose()` on disconnect).
 *
 * We use this instead of Canvas2D's `ctx.filter` because that
 * property is unsupported (or unreliable) in older WebKit versions —
 * including the WKWebView Tauri ships against on macOS — which is
 * why the sliders previously appeared to do nothing.
 *
 * Caching: the source texture is uploaded once per bitmap (a 40 MP
 * upload is the expensive part). Re-rendering with new tone uniforms
 * is essentially free.
 */
import type { ToneEdit } from "@domain/edits";

export type ToneSource = ImageBitmap | HTMLCanvasElement | OffscreenCanvas;

/**
 * Per-region tunables for the Blacks / Shadows / Highlights / Whites
 * sliders. Tweak these to make the sliders more or less aggressive
 * and to widen / narrow the luminance band each one targets.
 *
 * `amplitude` — maximum signed luminance offset at slider ±100 and
 *   peak weight. The smaller this number, the less the slider does.
 *
 * `weightExp` — the shape of the per-region weight curve:
 *   - `{ kind: "endpoint-low",  exp: n }` →  weight = (1-L)^n
 *     (Blacks — bigger `n` = sharper localisation at L≈0).
 *   - `{ kind: "endpoint-high", exp: n }` →  weight = L^n
 *     (Whites — bigger `n` = sharper localisation at L≈1).
 *   - `{ kind: "midtone", a, b }` →  weight = K · L^a · (1-L)^b
 *     (Shadows / Highlights — bump centred at L = a/(a+b);
 *     larger a+b narrows the bump). K is auto-computed so the bump
 *     peaks at exactly 1.0.
 */
type RegionWeight =
  | { kind: "endpoint-low"; exp: number }
  | { kind: "endpoint-high"; exp: number }
  | { kind: "midtone"; a: number; b: number };

const TONE_REGION: Record<
  "blacks" | "shadows" | "highlights" | "whites",
  { amplitude: number; weightExp: RegionWeight }
> = {
  blacks: { amplitude: 0.25, weightExp: { kind: "endpoint-low", exp: 10 } },
  whites: { amplitude: 0.25, weightExp: { kind: "endpoint-high", exp: 10 } },
  shadows: { amplitude: 0.18, weightExp: { kind: "midtone", a: 1, b: 5 } },
  highlights: { amplitude: 0.18, weightExp: { kind: "midtone", a: 5, b: 1 } },
};

/** GLSL float literal with a decimal point, so the WebGL2 compiler
 *  treats it as a float and not an int. */
function glslFloat(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : n.toString();
}

/** Build the GLSL weight expression for a region from its
 *  {@link RegionWeight} descriptor. */
function regionWeightGlsl(w: RegionWeight): string {
  switch (w.kind) {
    case "endpoint-low":
      return `pow(oneMinusL, ${glslFloat(w.exp)})`;
    case "endpoint-high":
      return `pow(L, ${glslFloat(w.exp)})`;
    case "midtone": {
      const { a, b } = w;
      const peak =
        (Math.pow(a, a) * Math.pow(b, b)) / Math.pow(a + b, a + b);
      const norm = peak > 0 ? 1 / peak : 1;
      return `${glslFloat(norm)} * pow(L, ${glslFloat(a)}) * pow(oneMinusL, ${glslFloat(b)})`;
    }
  }
}

function toneCoefficients(t: ToneEdit): {
  temperature: number;
  tint: number;
  exposure: number;
  contrast: number;
  saturation: number;
  blacks: number;
  shadows: number;
  highlights: number;
  whites: number;
} {
  return {
    temperature: t.temperature / 100,
    tint: t.tint / 100,
    exposure: Math.pow(2, t.exposure / 100),
    contrast: Math.max(0, 1 + t.contrast / 200),
    saturation: Math.max(0, 1 + t.saturation / 100),
    blacks: t.blacks / 100,
    shadows: t.shadows / 100,
    highlights: t.highlights / 100,
    whites: t.whites / 100,
  };
}

export class TonePipeline {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private texture: WebGLTexture | null = null;
  private uploadedBitmap: ToneSource | null = null;
  private uniforms: {
    temperature: WebGLUniformLocation | null;
    tint: WebGLUniformLocation | null;
    exposure: WebGLUniformLocation | null;
    contrast: WebGLUniformLocation | null;
    saturation: WebGLUniformLocation | null;
    blacks: WebGLUniformLocation | null;
    shadows: WebGLUniformLocation | null;
    highlights: WebGLUniformLocation | null;
    whites: WebGLUniformLocation | null;
    srcOffset: WebGLUniformLocation | null;
    srcScale: WebGLUniformLocation | null;
  } = {
    temperature: null,
    tint: null,
    exposure: null,
    contrast: null,
    saturation: null,
    blacks: null,
    shadows: null,
    highlights: null,
    whites: null,
    srcOffset: null,
    srcScale: null,
  };
  private failed = false;

  constructor() {
    this.canvas = document.createElement("canvas");
  }

  /**
   * Render the sub-rectangle `(srcRect.sx, sy)..(+sw, +sh)` of `bm`
   * with `tone` applied, into an internal canvas of size `outW × outH`.
   * Returns `null` if WebGL initialisation failed.
   */
  render(
    bm: ToneSource,
    tone: ToneEdit,
    srcRect: { sx: number; sy: number; sw: number; sh: number },
    outW: number,
    outH: number
  ): HTMLCanvasElement | null {
    if (this.failed) return null;
    if (!this.gl && !this.initGl()) return null;
    const gl = this.gl!;
    if (this.canvas.width !== outW) this.canvas.width = outW;
    if (this.canvas.height !== outH) this.canvas.height = outH;
    if (this.uploadedBitmap !== bm) {
      this.uploadTexture(bm);
    }
    const c = toneCoefficients(tone);
    const sx = srcRect.sx / bm.width;
    const sy = srcRect.sy / bm.height;
    const sw = srcRect.sw / bm.width;
    const sh = srcRect.sh / bm.height;
    gl.viewport(0, 0, outW, outH);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform1f(this.uniforms.temperature, c.temperature);
    gl.uniform1f(this.uniforms.tint, c.tint);
    gl.uniform1f(this.uniforms.exposure, c.exposure);
    gl.uniform1f(this.uniforms.contrast, c.contrast);
    gl.uniform1f(this.uniforms.saturation, c.saturation);
    gl.uniform1f(this.uniforms.blacks, c.blacks);
    gl.uniform1f(this.uniforms.shadows, c.shadows);
    gl.uniform1f(this.uniforms.highlights, c.highlights);
    gl.uniform1f(this.uniforms.whites, c.whites);
    gl.uniform2f(this.uniforms.srcOffset, sx, sy);
    gl.uniform2f(this.uniforms.srcScale, sw, sh);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return this.canvas;
  }

  /** Drop the cached texture upload so the next `render()` re-uploads.
   * Called when the canvas swaps to a different bitmap. */
  invalidate() {
    this.uploadedBitmap = null;
  }

  /** Pre-initialise the GL context, compile the shader program, and
   * upload `bm` as a texture so the next `render()` only needs to
   * issue a draw call. */
  warmup(bm: ToneSource): void {
    if (this.failed) return;
    if (!this.gl && !this.initGl()) return;
    if (this.uploadedBitmap === bm) return;
    this.uploadTexture(bm);
  }

  dispose() {
    const gl = this.gl;
    if (!gl) return;
    if (this.program) gl.deleteProgram(this.program);
    if (this.texture) gl.deleteTexture(this.texture);
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.program = null;
    this.texture = null;
    this.vao = null;
    this.gl = null;
    this.uploadedBitmap = null;
  }

  private initGl(): boolean {
    const gl = this.canvas.getContext("webgl2", {
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    }) as WebGL2RenderingContext | null;
    if (!gl) {
      this.failed = true;
      console.warn("WebGL2 unavailable — tone adjustments disabled");
      return false;
    }
    this.gl = gl;
    if (!this.initProgram()) {
      this.failed = true;
      return false;
    }
    return true;
  }

  private uploadTexture(bm: ToneSource): void {
    const gl = this.gl!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      bm
    );
    this.uploadedBitmap = bm;
  }

  private initProgram(): boolean {
    const gl = this.gl!;
    // Y is flipped in clip space so the GL framebuffer's bottom-left
    // origin lines up with `drawImage`'s top-left read order.
    const vsSource = `#version 300 es
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
    // Pipeline: exposure → region offsets → contrast → saturation.
    const wB = regionWeightGlsl(TONE_REGION.blacks.weightExp);
    const wS = regionWeightGlsl(TONE_REGION.shadows.weightExp);
    const wH = regionWeightGlsl(TONE_REGION.highlights.weightExp);
    const wW = regionWeightGlsl(TONE_REGION.whites.weightExp);
    const aB = glslFloat(TONE_REGION.blacks.amplitude);
    const aS = glslFloat(TONE_REGION.shadows.amplitude);
    const aH = glslFloat(TONE_REGION.highlights.amplitude);
    const aW = glslFloat(TONE_REGION.whites.amplitude);
    const fsSource = `#version 300 es
      precision highp float;
      uniform sampler2D u_tex;
      uniform float u_temperature;
      uniform float u_tint;
      uniform float u_exposure;
      uniform float u_contrast;
      uniform float u_saturation;
      uniform float u_blacks;
      uniform float u_shadows;
      uniform float u_highlights;
      uniform float u_whites;
      in vec2 v_uv;
      out vec4 outColor;

      const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

      void main() {
        vec4 src = texture(u_tex, v_uv);
        vec3 col = src.rgb * u_exposure;

        // White balance: temperature pushes blue\u2194yellow, tint pushes
        // magenta\u2194green. Amplitudes are intentionally modest so the
        // sliders feel like calibration, not a colour-cast filter.
        col += vec3( u_temperature,  0.0,           -u_temperature) * 0.15;
        col += vec3(-u_tint,         u_tint,        -u_tint       ) * 0.08;
        col = max(col, vec3(0.0));

        float L = clamp(dot(col, LUMA), 0.0, 1.0);
        float oneMinusL = 1.0 - L;

        float wBlacks    = ${wB};
        float wWhites    = ${wW};
        float wShadows   = ${wS};
        float wHighlights= ${wH};

        float offset =
            u_blacks     * ${aB} * wBlacks
          + u_shadows    * ${aS} * wShadows
          + u_highlights * ${aH} * wHighlights
          + u_whites     * ${aW} * wWhites;
        col += vec3(offset);

        col = (col - 0.5) * u_contrast + 0.5;

        float postLuma = dot(col, LUMA);
        col = mix(vec3(postLuma), col, u_saturation);

        outColor = vec4(col, src.a);
      }
    `;
    const vs = this.compile(gl.VERTEX_SHADER, vsSource);
    const fs = this.compile(gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return false;
    const program = gl.createProgram();
    if (!program) return false;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("tone shader link failed:", gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return false;
    }
    this.program = program;
    this.uniforms.temperature = gl.getUniformLocation(program, "u_temperature");
    this.uniforms.tint = gl.getUniformLocation(program, "u_tint");
    this.uniforms.exposure = gl.getUniformLocation(program, "u_exposure");
    this.uniforms.contrast = gl.getUniformLocation(program, "u_contrast");
    this.uniforms.saturation = gl.getUniformLocation(program, "u_saturation");
    this.uniforms.blacks = gl.getUniformLocation(program, "u_blacks");
    this.uniforms.shadows = gl.getUniformLocation(program, "u_shadows");
    this.uniforms.highlights = gl.getUniformLocation(program, "u_highlights");
    this.uniforms.whites = gl.getUniformLocation(program, "u_whites");
    this.uniforms.srcOffset = gl.getUniformLocation(program, "u_srcOffset");
    this.uniforms.srcScale = gl.getUniformLocation(program, "u_srcScale");

    // Fullscreen quad as two triangles in clip space.
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    // prettier-ignore
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1,  1, -1,  -1,  1,
        -1,  1,  1, -1,   1,  1,
      ]),
      gl.STATIC_DRAW
    );
    const posLoc = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    this.vao = vao;

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.texture = tex;
    return true;
  }

  private compile(type: number, src: string): WebGLShader | null {
    const gl = this.gl!;
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(
        "tone shader compile failed:",
        gl.getShaderInfoLog(shader)
      );
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }
}

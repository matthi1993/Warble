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
import type { CurveEdit, ToneEdit } from "@domain/edits";
import { buildCurveLutTextureData, isCurveZero } from "@domain/edits";
import type { GrainSettings } from "@services/post-process/post-process-store";
import type { BloomSettings } from "@services/effects/effects-store";

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
  /** 256x2 RGBA LUT for the per-photo edit curve (texture unit 1). */
  private editLutTex: WebGLTexture | null = null;
  /** 256x2 RGBA LUT for the global post-process curve (texture unit 2). */
  private postLutTex: WebGLTexture | null = null;
  /** Last-uploaded curve references so we don't re-upload an
   *  identical LUT every frame during a slider drag. */
  private uploadedEditCurve: CurveEdit | null = null;
  private uploadedPostCurve: CurveEdit | null = null;
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
    editLut: WebGLUniformLocation | null;
    editLutEnabled: WebGLUniformLocation | null;
    postLut: WebGLUniformLocation | null;
    postLutEnabled: WebGLUniformLocation | null;
    grainSize: WebGLUniformLocation | null;
    grainSeed: WebGLUniformLocation | null;
    grainAmount: WebGLUniformLocation | null;
    bloomStrength: WebGLUniformLocation | null;
    bloomSize: WebGLUniformLocation | null;
    bloomThreshold: WebGLUniformLocation | null;
    bloomStep: WebGLUniformLocation | null;
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
    editLut: null,
    editLutEnabled: null,
    postLut: null,
    postLutEnabled: null,
    grainSize: null,
    grainSeed: null,
    grainAmount: null,
    bloomStrength: null,
    bloomSize: null,
    bloomThreshold: null,
    bloomStep: null,
  };
  private failed = false;

  constructor() {
    this.canvas = document.createElement("canvas");
  }

  /**
   * Render the sub-rectangle `(srcRect.sx, sy)..(+sw, +sh)` of `bm`
   * with `tone` applied, into an internal canvas of size `outW × outH`.
   * Returns `null` if WebGL initialisation failed.
   *
   * `opts.curve` is the per-photo tone curve (applied right after
   * the tone math); `opts.postCurve` and `opts.grain` are the global
   * post-process effects (applied at the very end of the chain).
   * Pass `null` (or omit) for any effect that should be bypassed.
   */
  render(
    bm: ToneSource,
    tone: ToneEdit,
    srcRect: { sx: number; sy: number; sw: number; sh: number },
    outW: number,
    outH: number,
    opts: {
      curve?: CurveEdit | null;
      postCurve?: CurveEdit | null;
      grain?: GrainSettings | null;
      bloom?: BloomSettings | null;
    } = {}
  ): HTMLCanvasElement | null {
    if (this.failed) return null;
    if (!this.gl && !this.initGl()) return null;
    const gl = this.gl!;
    if (this.canvas.width !== outW) this.canvas.width = outW;
    if (this.canvas.height !== outH) this.canvas.height = outH;
    if (this.uploadedBitmap !== bm) {
      this.uploadTexture(bm);
    }
    // Curve LUT uploads: skipped when the curve is identity (the
    // shader-side enabled flag short-circuits the lookup) or
    // unchanged since the last frame.
    const editCurveActive = !!opts.curve && !isCurveZero(opts.curve);
    if (editCurveActive && opts.curve !== this.uploadedEditCurve) {
      this.uploadCurveLut(this.editLutTex, opts.curve!);
      this.uploadedEditCurve = opts.curve!;
    }
    const postCurveActive = !!opts.postCurve && !isCurveZero(opts.postCurve);
    if (postCurveActive && opts.postCurve !== this.uploadedPostCurve) {
      this.uploadCurveLut(this.postLutTex, opts.postCurve!);
      this.uploadedPostCurve = opts.postCurve!;
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
    gl.uniform1i(this.uniforms.editLutEnabled, editCurveActive ? 1 : 0);
    gl.uniform1i(this.uniforms.postLutEnabled, postCurveActive ? 1 : 0);
    const grain = opts.grain;
    // `amount` is the master grain knob (0 disables grain entirely).
    // `size` clamps to a small floor so the shader never divides by
    // zero.
    gl.uniform1f(
      this.uniforms.grainSize,
      grain ? Math.max(0.1, grain.size) : 1
    );
    gl.uniform1f(this.uniforms.grainSeed, grain ? grain.seed : 0);
    gl.uniform1f(this.uniforms.grainAmount, grain ? grain.amount : 0);
    const bloom = opts.bloom;
    const bloomStrength = bloom ? bloom.strength : 0;
    gl.uniform1f(this.uniforms.bloomStrength, bloomStrength);
    gl.uniform1f(this.uniforms.bloomSize, bloom ? bloom.size : 0);
    gl.uniform1f(this.uniforms.bloomThreshold, bloom ? bloom.threshold : 0);
    // Step in source-UV space: one screen-pixel = (1/outW, 1/outH)
    // in the destination, which maps to (sw/outW, sh/outH) in
    // source-UV. Using outW/outH here keeps bloom radius constant in
    // *screen* pixels regardless of zoom, which feels right when
    // the user drags the slider.
    gl.uniform2f(
      this.uniforms.bloomStep,
      bloomStrength > 0 ? sw / outW : 0,
      bloomStrength > 0 ? sh / outH : 0
    );
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.uniforms.editLut!, 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.editLutTex);
    gl.uniform1i(this.uniforms.postLut!, 2);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.postLutTex);
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
    if (this.editLutTex) gl.deleteTexture(this.editLutTex);
    if (this.postLutTex) gl.deleteTexture(this.postLutTex);
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.program = null;
    this.texture = null;
    this.editLutTex = null;
    this.postLutTex = null;
    this.vao = null;
    this.gl = null;
    this.uploadedBitmap = null;
    this.uploadedEditCurve = null;
    this.uploadedPostCurve = null;
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
    // Generate the full mipmap chain so the bloom pass can sample
    // pre-averaged lower levels via textureLod() — each tap then
    // covers an area instead of a point, blending smoothly across
    // the disc instead of leaving visible copies of bright spots.
    gl.generateMipmap(gl.TEXTURE_2D);
    this.uploadedBitmap = bm;
  }

  /** Upload a packed 256x2 RGBA LUT into the given texture. The
   *  packing convention matches `buildCurveLutTextureData`:
   *    row 0 RGBA = (r, g, b, rgb-combined)
   *    row 1 RGBA = (luma, 0, 0, 255)
   */
  private uploadCurveLut(tex: WebGLTexture | null, curve: CurveEdit): void {
    if (!tex) return;
    const gl = this.gl!;
    const data = buildCurveLutTextureData(curve);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      256,
      2,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data
    );
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
      uniform sampler2D u_editLut;
      uniform sampler2D u_postLut;
      uniform int u_editLutEnabled;
      uniform int u_postLutEnabled;
      uniform float u_temperature;
      uniform float u_tint;
      uniform float u_exposure;
      uniform float u_contrast;
      uniform float u_saturation;
      uniform float u_blacks;
      uniform float u_shadows;
      uniform float u_highlights;
      uniform float u_whites;
      uniform float u_grainSize;
      uniform float u_grainSeed;
      uniform float u_grainAmount;
      uniform float u_bloomStrength;
      uniform float u_bloomSize;
      uniform float u_bloomThreshold;
      uniform vec2  u_bloomStep;
      in vec2 v_uv;
      out vec4 outColor;

      const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

      // Apply a packed 256x2 RGBA LUT (per-channel R/G/B in row 0
      // RGB, combined RGB curve in row 0 A, luma curve in row 1 R).
      // We sample with half-texel offsets so 0 -> first texel center
      // and 1 -> last texel center, which keeps the endpoints exact.
      vec3 applyCurveLut(vec3 col, sampler2D lut) {
        vec3 cc = clamp(col, 0.0, 1.0);
        // Row 0 — per-channel.
        float u_r = cc.r * (255.0 / 256.0) + (0.5 / 256.0);
        float u_g = cc.g * (255.0 / 256.0) + (0.5 / 256.0);
        float u_b = cc.b * (255.0 / 256.0) + (0.5 / 256.0);
        float row0 = 0.25;
        float row1 = 0.75;
        float r = texture(lut, vec2(u_r, row0)).r;
        float g = texture(lut, vec2(u_g, row0)).g;
        float b = texture(lut, vec2(u_b, row0)).b;
        // Combined RGB curve (alpha channel of row 0).
        float u_rgb_r = r * (255.0 / 256.0) + (0.5 / 256.0);
        float u_rgb_g = g * (255.0 / 256.0) + (0.5 / 256.0);
        float u_rgb_b = b * (255.0 / 256.0) + (0.5 / 256.0);
        r = texture(lut, vec2(u_rgb_r, row0)).a;
        g = texture(lut, vec2(u_rgb_g, row0)).a;
        b = texture(lut, vec2(u_rgb_b, row0)).a;
        // Luma curve: applied as an ADDITIVE shift in linear space
        // (col += L' - L) rather than a multiplicative scale
        // (col *= L' / L). The multiplicative form blows up near
        // black — with the original luminance near 0 the division
        // amplifies whichever channel had the most leakage and the
        // shadow lift turns red. An additive shift lifts shadows
        // hue-neutrally: black goes to grey, not to a colour cast.
        vec3 rgbBefore = vec3(r, g, b);
        float L = clamp(dot(rgbBefore, LUMA), 0.0, 1.0);
        float u_l = L * (255.0 / 256.0) + (0.5 / 256.0);
        float lNew = texture(lut, vec2(u_l, row1)).r;
        return rgbBefore + vec3(lNew - L);
      }

      // ===== Film-scan noise primitives =================================
      // Three-arg IQ-style hash. Stable across drivers, returns [0,1).
      float hash13(vec3 p) {
        p = fract(p * vec3(123.34, 345.45, 567.56));
        p += dot(p, p.yzx + 34.345);
        return fract(p.x * p.y * p.z);
      }

      // 2D smooth value noise: bilinear hash interpolation with the
      // classic cubic falloff. The z arg decorrelates octaves and
      // channels. Used for dust / scratch fields (where axis-aligned
      // grid artefacts don't matter — the cells ARE the features).
      float vnoise(vec2 p, float z) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float a = hash13(vec3(i, z));
        float b = hash13(vec3(i + vec2(1.0, 0.0), z));
        float c = hash13(vec3(i + vec2(0.0, 1.0), z));
        float d = hash13(vec3(i + vec2(1.0, 1.0), z));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }

      // Random unit-ish gradient vector at integer lattice point p.
      // Decorrelated per-z so octaves don't lock together.
      vec2 hash22(vec2 p, float z) {
        float a = hash13(vec3(p,           z));
        float b = hash13(vec3(p + 19.19,   z + 7.0));
        return vec2(a, b) * 2.0 - 1.0;
      }

      // Gradient (Perlin-style) noise. Unlike value noise this has
      // its zeros at the grid points (not its extrema), so the
      // axis-aligned grid is invisible — exactly the property we
      // need to avoid the "fine repeating grid" artefact that value
      // noise produces when sampled near pixel density. Output is
      // roughly in [-0.7, 0.7].
      float gnoise(vec2 p, float z) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = dot(hash22(i,                 z), f);
        float b = dot(hash22(i + vec2(1.0, 0.0), z), f - vec2(1.0, 0.0));
        float c = dot(hash22(i + vec2(0.0, 1.0), z), f - vec2(0.0, 1.0));
        float d = dot(hash22(i + vec2(1.0, 1.0), z), f - vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }

      // Multi-octave grain. Each octave samples through a different
      // rotation matrix so the lattice grids of successive octaves
      // don't line up — eliminates any residual axis-aligned moiré
      // even at coarse sampling rates. Approximately gaussian by
      // central-limit (sum of decorrelated noises), which is the
      // distribution real photographic grain follows.
      //
      // We also fold in a layer of cellular (Worley) noise so the
      // grain has irregular clumps of varying sizes — much closer
      // to the look of real silver-halide crystals than pure
      // gradient noise, which always reads as a fine evenly-spaced
      // grid no matter how many octaves you stack.
      //
      // Cellular noise: for each pixel, find the distance to the
      // nearest jittered feature point inside a 3×3 cell
      // neighbourhood. Two distances (F1, F2) are kept so the
      // difference F2-F1 traces the crystal boundaries — sharp
      // edges instead of soft blobs.
      vec2 cellularF1F2(vec2 p, float z) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float f1 = 8.0;
        float f2 = 8.0;
        for (int y = -1; y <= 1; y++) {
          for (int x = -1; x <= 1; x++) {
            vec2 g = vec2(float(x), float(y));
            // Per-cell feature offset in [0, 1].
            vec2 o = hash22(i + g, z) * 0.5 + 0.5;
            vec2 r = g + o - f;
            float d = dot(r, r);
            if (d < f1) { f2 = f1; f1 = d; }
            else if (d < f2) { f2 = d; }
          }
        }
        return vec2(sqrt(f1), sqrt(f2));
      }

      float filmGrain(vec2 p, float z) {
        // 31°, 67°, 112° — three irrational-feeling angles.
        mat2 r1 = mat2( 0.857, -0.515,  0.515,  0.857);
        mat2 r2 = mat2( 0.391, -0.920,  0.920,  0.391);
        mat2 r3 = mat2(-0.375, -0.927,  0.927, -0.375);
        // Two gradient-noise octaves to provide the broad gaussian
        // body of the grain distribution.
        float g  = gnoise(r1 * p,         z)        * 0.50;
              g += gnoise(r2 * p * 2.13,  z + 5.0)  * 0.25;
        // Cellular noise octave: F2-F1 traces irregular crystal
        // boundaries. Scaled and zero-centred so it sums into the
        // gaussian-ish body without biasing it.
        vec2 fF = cellularF1F2(r3 * p * 1.7, z + 9.0);
        float cells = (fF.y - fF.x) * 1.4 - 0.4;
        g += cells * 0.35;
        // gnoise() output is ~[-0.4, 0.4]; rescale so the effective
        // standard deviation lines up with what the slider
        // amplitudes (ampLuma/ampChroma below) were tuned against.
        return g * 2.5;
      }

      void main() {
        vec4 src = texture(u_tex, v_uv);

        // Highlight bloom — built as a soft alpha mask, not a
        // colour-additive halo.
        //
        //   1. Per tap, threshold the source luminance against
        //      u_bloomThreshold with a smooth knee. This yields a
        //      binary-ish "is this pixel a highlight?" alpha in
        //      [0, 1].
        //   2. The taps are spread on a sunflower disc of radius
        //      ~u_bloomSize source pixels and weighted by a 2D
        //      Gaussian in radial distance — i.e. we Gaussian-
        //      blur the highlight alpha mask in a single pass.
        //   3. The resulting blurred mask M ∈ [0, 1] is used as
        //      an exposure multiplier: rgb *= 1 + strength · M.
        //
        // Because the mask is blurred, pixels *near* a highlight
        // get brightened too (a dark pixel adjacent to a bright
        // light receives spill-over) — that's exactly the lens-
        // halation look real photographic bloom has. The centre
        // pixel's own colour is preserved, just exposed brighter,
        // so highlights don't pick up the chroma of their
        // neighbours.
        if (u_bloomStrength > 0.0) {
          float thr  = u_bloomThreshold * 0.01;
          float knee = 0.15;
          float sigma = max(u_bloomSize, 0.5);
          float radius = sigma * 2.5;
          float invTwoSigmaSq = 1.0 / (2.0 * sigma * sigma);

          // Mip LOD chosen so each tap's source-texel footprint
          // *exceeds* the spacing between adjacent taps on the
          // disc, guaranteeing overlap and a continuous blur.
          // With N taps on a sunflower of radius R, average
          // neighbour spacing is ~R · sqrt(π/N); we set the
          // footprint to roughly 2× that so neighbouring taps'
          // averaged regions clearly overlap and you don't see
          // discrete copies of bright features at large radii.
          // Floor-clamped at 0 (no negative LOD).
          float lod = max(log2(radius * 0.65), 0.0);

          const int N = 48;
          // Golden angle (radians) — 2π · (1 − 1/φ).
          const float GOLDEN = 2.39996323;

          float maskAcc = 0.0;
          float wsum = 0.0;
          for (int i = 0; i < N; i++) {
            // Uniform disc sampling: r ∝ sqrt(t) keeps sample
            // density constant per unit area.
            float t = (float(i) + 0.5) / float(N);
            float r = sqrt(t) * radius;
            float a = float(i) * GOLDEN;
            vec2 offset = vec2(cos(a), sin(a)) * r;
            // textureLod fetches from a pre-averaged mip level —
            // each tap is itself a small box-blur of the source,
            // so the disc reads as a continuous Gaussian instead
            // of N discrete point samples.
            vec3 s = textureLod(u_tex, v_uv + offset * u_bloomStep, lod).rgb;
            float l = dot(s, LUMA);
            // Smooth knee: 0 below thr-knee, 1 above thr+knee.
            float mask = smoothstep(thr - knee, thr + knee, l);
            float w = exp(-(r * r) * invTwoSigmaSq);
            maskAcc += mask * w;
            wsum += w;
          }
          // Fold in the centre sample at full resolution so a lone
          // bright pixel still receives full boost even when its
          // neighbours are dark.
          {
            float l = dot(src.rgb, LUMA);
            float mask = smoothstep(thr - knee, thr + knee, l);
            maskAcc += mask * 1.0;
            wsum += 1.0;
          }
          float M = maskAcc / max(wsum, 1e-4);
          // u_bloomStrength is a percentage exposure boost at
          // M=1: slider=100 doubles the brightness of fully-
          // masked pixels, slider=300 quadruples it. Scaling
          // factor 0.01 = "per percent".
          src.rgb *= 1.0 + u_bloomStrength * 0.01 * M;
        }

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

        // Per-photo edit curve (after the basic tone math so the
        // user sees the curve operating on the already-graded image).
        if (u_editLutEnabled == 1) {
          col = applyCurveLut(col, u_editLut);
        }

        // ===== POST-PROCESS / FILM-SCAN PASS =========================
        // Everything below operates in an "image-anchored" coordinate
        // p that is independent of zoom/pan/resolution: it's the
        // photo's normalised UV mapped onto a 700-unit virtual film
        // plane. The base was chosen so that at size=1.5 each grain
        // cell covers ~3-4 screen pixels at a typical 2000px display
        // width — large enough to dodge pixel-density Moiré (the
        // "fine repeating grid" you get when noise cells are
        // sub-pixel), but still fine enough to read as grain rather
        // than blobs.
        if (u_postLutEnabled == 1) {
          col = applyCurveLut(col, u_postLut);
        }

        // Virtual film plane. Size knob is inverted into the coord
        // scale: larger size -> fewer cells across -> chunkier
        // grain (high-ISO push look); smaller size -> finer grain
        // (slow-speed film). The seed is folded in as both a coord
        // offset (translates the pattern) and a third hash
        // dimension (reshuffles every artifact in lockstep).
        float gz = u_grainSeed * 0.013;
        vec2 p = v_uv * vec2(700.0) / max(u_grainSize, 0.1)
               + vec2(u_grainSeed * 0.37, u_grainSeed * 0.71);

        if (u_grainAmount > 0.0) {
          // Luma-aware grain response. Real film grain visibility
          // depends on local density:
          //   - In deep shadows almost no crystals were exposed, so
          //     the grain pattern has little signal to carry. Drop
          //     to ~30%.
          //   - In bright highlights nearly every crystal saturated,
          //     so the layer is uniform — visible grain ~25%.
          //   - The peak is in the lower-midtones (around L≈0.35),
          //     where density variation is highest. This is the
          //     classic "shadow grain" look of scanned film.
          float Lpx = clamp(dot(col, LUMA), 0.0, 1.0);
          float bell = 4.0 * Lpx * (1.0 - Lpx);     // 0..1 mid-peak
          float shadowBias = 1.0 - 0.55 * Lpx;       // weight shadows
          float response = clamp(0.25 + 0.9 * bell * shadowBias,
                                 0.0, 1.0);

          // Luminance grain — monochrome high-amplitude layer that
          // drives the perceived "graininess".
          float gLuma = filmGrain(p, gz);
          // Chroma grain — three decorrelated noise fields offset
          // in coordinate / hash space. Tiny amplitude so colours
          // shift slightly cell-to-cell, the hallmark of real
          // colour-negative scans (mono grain is too "digital").
          vec3 gChroma = vec3(
            filmGrain(p + vec2( 3.1, 7.2), gz + 11.0),
            filmGrain(p + vec2(11.7, 1.3), gz + 23.0),
            filmGrain(p + vec2( 5.4, 9.8), gz + 41.0)
          );

          // Amplitude: gentle power curve so small slider values
          // are still useful and 100 reaches a strong push-process
          // look without going completely destructive.
          float a = u_grainAmount * 0.01;
          float ampLuma   = pow(a, 0.75) * 0.22;
          float ampChroma = pow(a, 0.85) * 0.06;

          vec3 grainColor = vec3(gLuma) * ampLuma
                          + gChroma     * ampChroma;
          col += grainColor * response;
        }

        outColor = vec4(clamp(col, 0.0, 1.0), src.a);
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
    this.uniforms.editLut = gl.getUniformLocation(program, "u_editLut");
    this.uniforms.editLutEnabled = gl.getUniformLocation(
      program,
      "u_editLutEnabled"
    );
    this.uniforms.postLut = gl.getUniformLocation(program, "u_postLut");
    this.uniforms.postLutEnabled = gl.getUniformLocation(
      program,
      "u_postLutEnabled"
    );
    this.uniforms.grainSize = gl.getUniformLocation(program, "u_grainSize");
    this.uniforms.grainSeed = gl.getUniformLocation(program, "u_grainSeed");
    this.uniforms.grainAmount = gl.getUniformLocation(program, "u_grainAmount");
    this.uniforms.bloomStrength = gl.getUniformLocation(
      program,
      "u_bloomStrength"
    );
    this.uniforms.bloomSize = gl.getUniformLocation(program, "u_bloomSize");
    this.uniforms.bloomThreshold = gl.getUniformLocation(
      program,
      "u_bloomThreshold"
    );
    this.uniforms.bloomStep = gl.getUniformLocation(program, "u_bloomStep");

    // Wire the source sampler to texture unit 0 once and for all.
    const uTex = gl.getUniformLocation(program, "u_tex");
    gl.useProgram(program);
    if (uTex) gl.uniform1i(uTex, 0);

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
    // Trilinear min filter so the bloom pass can sample lower mip
    // levels via textureLod() to bridge tap gaps in its disc.
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.texture = tex;

    // LUT textures (256x2 RGBA). Linear filtering on x interpolates
    // between adjacent LUT entries so we get smooth curves; nearest
    // on y so row 0 (per-channel + RGB combined) and row 1 (luma)
    // don't bleed into each other.
    const makeLut = (): WebGLTexture | null => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // Pre-fill with an identity ramp so the texture is sampleable
      // even before the first uploadCurveLut() call.
      const seed = new Uint8Array(256 * 2 * 4);
      for (let i = 0; i < 256; i++) {
        seed[i * 4 + 0] = i;
        seed[i * 4 + 1] = i;
        seed[i * 4 + 2] = i;
        seed[i * 4 + 3] = i;
        const r1 = (256 + i) * 4;
        seed[r1 + 0] = i;
        seed[r1 + 1] = 0;
        seed[r1 + 2] = 0;
        seed[r1 + 3] = 255;
      }
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        256,
        2,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        seed
      );
      return t;
    };
    this.editLutTex = makeLut();
    this.postLutTex = makeLut();
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

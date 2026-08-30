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
import type { ColorEdit, CurveEdit, ToneEdit } from "@domain/edits";
import {
  buildCurveLutTextureData,
  COLOR_CHANNELS,
  COLOR_CHANNEL_HUES,
  defaultColor,
  isColorZero,
  isCurveZero,
} from "@domain/edits";
import type { SharpenSettings } from "@services/effects/effects-store";
import type { GrainSettings } from "@services/post-process/post-process-store";

export type ToneSource = ImageBitmap | HTMLCanvasElement | OffscreenCanvas;

/** One cached noise field is enough for both grain modes. Red/green hold
 * bell-shaped random values for organic grain; blue holds binary black or
 * white values for the per-pixel mode. */
const GRAIN_TEXTURE_SIZE = 1024;

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

/** Pack a {@link ColorEdit} into the shader uniform layout:
 *    channels[8] = (hue/100, sat/100, val/100) per channel
 *    global       = (hue/100, sat/100, val/100)
 *  The shader does the rest (per-hue weight blending + wrap).
 *
 *  Channel order MUST match `COLOR_CHANNELS` in `@domain/edits` and
 *  the centre table in the fragment shader (`applyColor`).
 */
function uploadColorUniforms(
  gl: WebGL2RenderingContext,
  channelsLoc: WebGLUniformLocation | null,
  globalLoc: WebGLUniformLocation | null,
  color: ColorEdit
): void {
  if (channelsLoc) {
    const buf = new Float32Array(8 * 3);
    for (let i = 0; i < COLOR_CHANNELS.length; i++) {
      const key = COLOR_CHANNELS[i];
      const ch = color.channels[key];
      buf[i * 3 + 0] = ch.hue / 100;
      buf[i * 3 + 1] = ch.saturation / 100;
      buf[i * 3 + 2] = ch.luminance / 100;
    }
    gl.uniform3fv(channelsLoc, buf);
    void COLOR_CHANNEL_HUES; // referenced only for table parity
  }
  if (globalLoc) {
    gl.uniform3f(
      globalLoc,
      color.hue / 100,
      color.saturation / 100,
      color.luminance / 100
    );
  }
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
  /** Procedural noise generated once, then sampled deterministically in
   *  image space for every redraw (texture unit 3). */
  private grainTex: WebGLTexture | null = null;
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
    editColorEnabled: WebGLUniformLocation | null;
    editColorChannels: WebGLUniformLocation | null;
    editColorGlobal: WebGLUniformLocation | null;
    postColorEnabled: WebGLUniformLocation | null;
    postColorChannels: WebGLUniformLocation | null;
    postColorGlobal: WebGLUniformLocation | null;
   editSharpenStrength: WebGLUniformLocation | null;
    editSharpenRadius: WebGLUniformLocation | null;
    editSharpenThreshold: WebGLUniformLocation | null;
    postSharpenStrength: WebGLUniformLocation | null;
    postSharpenRadius: WebGLUniformLocation | null;
    postSharpenThreshold: WebGLUniformLocation | null;
    sharpenStep: WebGLUniformLocation | null;
    grainTexture: WebGLUniformLocation | null;
    grainSize: WebGLUniformLocation | null;
    grainAmount: WebGLUniformLocation | null;
    grainFine: WebGLUniformLocation | null;
    sourceSize: WebGLUniformLocation | null;
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
    editColorEnabled: null,
    editColorChannels: null,
    editColorGlobal: null,
    postColorEnabled: null,
    postColorChannels: null,
    postColorGlobal: null,
   editSharpenStrength: null,
    editSharpenRadius: null,
    editSharpenThreshold: null,
    postSharpenStrength: null,
    postSharpenRadius: null,
    postSharpenThreshold: null,
    sharpenStep: null,
    grainTexture: null,
    grainSize: null,
    grainAmount: null,
    grainFine: null,
    sourceSize: null,
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
   * the tone math); `opts.postCurve` is the global post-process
   * curve (applied at the end of the chain). `opts.editColor` and
   * `opts.postColor` apply per-hue HSL adjustments before each
   * curve. Pass `null` (or omit) for any effect that should be
   * bypassed.
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
      editColor?: ColorEdit | null;
      postColor?: ColorEdit | null;
      /** Per-photo sharpening applied AFTER the per-photo color +
       *  curve passes but BEFORE the post-process layer, so it
       *  acts on the photo's "as edited" state. */
      sharpen?: SharpenSettings | null;
      /** Global sharpening applied as the very last pass, after
       *  post color + post curve. Conceptually the "output
       *  sharpening" stage. */
      postSharpen?: SharpenSettings | null;
      /** Final image-space grain overlay. The cached noise texture is
       *  stable across redraws, pan, and zoom. */
      grain?: GrainSettings | null;
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
    const editColor = opts.editColor ?? null;
    const postColor = opts.postColor ?? null;
    const editColorActive = !!editColor && !isColorZero(editColor);
    const postColorActive = !!postColor && !isColorZero(postColor);
    gl.uniform1i(this.uniforms.editColorEnabled, editColorActive ? 1 : 0);
    gl.uniform1i(this.uniforms.postColorEnabled, postColorActive ? 1 : 0);
    uploadColorUniforms(
      gl,
      this.uniforms.editColorChannels,
      this.uniforms.editColorGlobal,
      editColor ?? defaultColor()
    );
    uploadColorUniforms(
      gl,
      this.uniforms.postColorChannels,
      this.uniforms.postColorGlobal,
      postColor ?? defaultColor()
    );
   const editSharpen = opts.sharpen;
   const postSharpen = opts.postSharpen;
    const editSharpenActive = !!editSharpen && editSharpen.strength > 0;
    const postSharpenActive = !!postSharpen && postSharpen.strength > 0;
    gl.uniform1f(
      this.uniforms.editSharpenStrength,
      editSharpenActive ? editSharpen!.strength : 0
    );
    gl.uniform1f(
      this.uniforms.editSharpenRadius,
      editSharpenActive ? Math.max(editSharpen!.radius, 0.3) : 1
    );
    gl.uniform1f(
      this.uniforms.editSharpenThreshold,
      editSharpenActive ? editSharpen!.threshold : 0
    );
    gl.uniform1f(
      this.uniforms.postSharpenStrength,
      postSharpenActive ? postSharpen!.strength : 0
    );
    gl.uniform1f(
      this.uniforms.postSharpenRadius,
      postSharpenActive ? Math.max(postSharpen!.radius, 0.3) : 1
    );
    gl.uniform1f(
      this.uniforms.postSharpenThreshold,
      postSharpenActive ? postSharpen!.threshold : 0
    );
    // Step in source-UV per *screen* pixel.
    // The shader multiplies by `radius` to convert into the blur
    // kernel's offsets so a radius=1 setting always spans roughly
    // one source pixel on screen regardless of zoom.
    gl.uniform2f(
      this.uniforms.sharpenStep,
      editSharpenActive || postSharpenActive ? sw / outW : 0,
      editSharpenActive || postSharpenActive ? sh / outH : 0
    );
    const grain = opts.grain;
    gl.uniform1f(this.uniforms.grainSize, grain?.size ?? 25);
    gl.uniform1f(this.uniforms.grainAmount, grain?.amount ?? 0);
    gl.uniform1f(this.uniforms.grainFine, grain?.fine ?? 0);
    gl.uniform2f(this.uniforms.sourceSize, bm.width, bm.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.uniforms.editLut!, 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.editLutTex);
    gl.uniform1i(this.uniforms.postLut!, 2);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.postLutTex);
    gl.uniform1i(this.uniforms.grainTexture!, 3);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.grainTex);
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
    if (this.grainTex) gl.deleteTexture(this.grainTex);
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.program = null;
    this.texture = null;
    this.editLutTex = null;
    this.postLutTex = null;
    this.grainTex = null;
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
   // Generate the full mipmap chain so the sharpen pass can sample
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
      uniform sampler2D u_grainTexture;
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
      uniform int   u_editColorEnabled;
      uniform vec3  u_editColorChannels[8];
      uniform vec3  u_editColorGlobal;
      uniform int   u_postColorEnabled;
      uniform vec3  u_postColorChannels[8];
      uniform vec3  u_postColorGlobal;
     uniform float u_editSharpenStrength;
      uniform float u_editSharpenRadius;
      uniform float u_editSharpenThreshold;
      uniform float u_postSharpenStrength;
      uniform float u_postSharpenRadius;
      uniform float u_postSharpenThreshold;
      uniform vec2  u_sharpenStep;
      uniform float u_grainSize;
      uniform float u_grainAmount;
      uniform float u_grainFine;
      uniform vec2  u_sourceSize;
      in vec2 v_uv;
      out vec4 outColor;

      const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
      const float GRAIN_TEX_SIZE = ${glslFloat(GRAIN_TEXTURE_SIZE)};

      // Organic grain is sampled in normalised image space. Only the
      // aspect ratio enters the coordinate calculation, so replacing an
      // 800 px source with a 2000 px source cannot change its size. The
      // fixed mip level shapes the same cached field into larger grains;
      // it does not create a new field as the viewport changes.
      float organicGrain() {
        float shortEdge = max(min(u_sourceSize.x, u_sourceSize.y), 1.0);
        vec2 imageAspect = u_sourceSize / shortEdge;
        vec2 p = v_uv * imageAspect;
        float size01 = clamp((u_grainSize - 1.0) / 99.0, 0.0, 1.0);
        float lod = mix(0.0, 4.0, size01);
        float a = textureLod(
          u_grainTexture,
          p + vec2(0.173, 0.417),
          lod
        ).r - 0.5;
        vec2 q = mat2(0.819, -0.574, 0.574, 0.819) * p;
        float b = textureLod(
          u_grainTexture,
          q + vec2(0.619, 0.271),
          lod
        ).g - 0.5;
        // Mip levels contain averages of 2^lod x 2^lod noise texels.
        // Restore their variance so changing Size changes grain diameter,
        // not the perceived strength of Amount.
        return (a * 0.82 + b * 0.58) * exp2(lod) * 1.35;
      }

      // Fine noise is binary black/white at native source-pixel centres.
      // Explicit gradients let the texture mipmaps correctly average many
      // source pixels when the photo is fitted below 100%, while zooming in
      // simply magnifies the already-selected pixel values.
      float fineGrain() {
        vec2 sourcePixel = floor(v_uv * u_sourceSize);
        vec2 uv = (mod(sourcePixel, GRAIN_TEX_SIZE) + 0.5)
          / GRAIN_TEX_SIZE;
        vec2 dx = dFdx(v_uv) * u_sourceSize / GRAIN_TEX_SIZE;
        vec2 dy = dFdy(v_uv) * u_sourceSize / GRAIN_TEX_SIZE;
        return textureGrad(u_grainTexture, uv, dx, dy).b * 2.0 - 1.0;
      }

      // Unsharp-mask high-pass: compares the source pixel against
      // a blurred neighbourhood of itself, gates the difference by
      // a luma-threshold (so flat areas / noise don't get
      // amplified), and returns the signed detail vector to ADD
      // back to the colour-graded output.
      //
      // We sample the source via textureLod() at lod = log2(radius)
      // so the "blur" is the GPU's pre-averaged mip — way cheaper
      // than a multi-tap Gaussian and visually equivalent at the
      // small radii sharpening uses. Combined with a 4-tap diagonal
      // ring sampled at the same lod, we get a smooth halo without
      // visible kernel grid artefacts.
      vec3 unsharpDetail(float radius, float threshold) {
        vec3 src = texture(u_tex, v_uv).rgb;
        float lod = max(log2(max(radius, 0.5)) + 0.5, 0.0);
        vec2 r = u_sharpenStep * radius;
        vec3 blurred =
            textureLod(u_tex, v_uv, lod).rgb * 0.5
          + textureLod(u_tex, v_uv + vec2( r.x,  r.y), lod).rgb * 0.125
          + textureLod(u_tex, v_uv + vec2(-r.x,  r.y), lod).rgb * 0.125
          + textureLod(u_tex, v_uv + vec2( r.x, -r.y), lod).rgb * 0.125
          + textureLod(u_tex, v_uv + vec2(-r.x, -r.y), lod).rgb * 0.125;
        vec3 detail = src - blurred;
        // Threshold gate on luma magnitude. 'threshold' is the
        // 0..50 slider value (interpreted as 0..50 in an 0–255
        // luminance scale, so divide by 255 to bring into the
        // shader's 0..1 space). Below the threshold we attenuate
        // to zero with a soft knee; above it we pass through 1:1.
        float lumDelta = abs(dot(detail, LUMA));
        float thr = threshold / 255.0;
        float gate = smoothstep(thr * 0.5, thr + 1e-4, lumDelta);
        // When threshold is 0 the smoothstep collapses to 1 for
        // any non-zero delta, which is what we want.
        if (threshold <= 0.0) gate = 1.0;
        return detail * gate;
      }

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

      // ===== HSV helpers for the per-hue color pass =====================
      // Branch-free rgb<->hsv conversion (Sam Hocevar).
      vec3 rgb2hsv(vec3 c) {
        vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
        vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
        vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
        float d = q.x - min(q.w, q.y);
        float e = 1.0e-10;
        return vec3(
          abs(q.z + (q.w - q.y) / (6.0 * d + e)),
          d / (q.x + e),
          q.x
        );
      }
      vec3 hsv2rgb(vec3 c) {
        vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
        vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
        return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
      }

      // Per-hue HSV adjustments with smooth gaussian-style weights
      // across the 8 channels. Each channel.xyz packs (hue, sat, val)
      // shifts in normalized units (slider/100 ∈ [-1, 1]).
      //  - hue shift:        ±30° per unit, hue-axis wraps
      //  - saturation shift: multiplicative, clamped to [0, 2]
      //  - value shift:      multiplicative, clamped to [0, 2]
      // Weights are normalized so they sum to 1 at every hue, which
      // means a flat global shift (no per-channel changes) behaves
      // identically across the spectrum.
      const float COLOR_SIGMA = 0.083; // ~30° in normalized hue
      vec3 applyColor(vec3 rgb, vec3 channels[8], vec3 globalShift) {
        // Centres in normalized hue [0, 1).
        // red, orange, yellow, green, aqua, blue, purple, magenta
        float centres[8];
        centres[0] = 0.0;
        centres[1] = 30.0/360.0;
        centres[2] = 60.0/360.0;
        centres[3] = 120.0/360.0;
        centres[4] = 180.0/360.0;
        centres[5] = 240.0/360.0;
        centres[6] = 270.0/360.0;
        centres[7] = 330.0/360.0;

        vec3 hsv = rgb2hsv(max(rgb, vec3(0.0)));
        float h = hsv.x;
        float s = hsv.y;
        float v = hsv.z;

        float invTwoSigmaSq = 1.0 / (2.0 * COLOR_SIGMA * COLOR_SIGMA);
        vec3 acc = vec3(0.0);
        float wsum = 0.0;
        for (int i = 0; i < 8; i++) {
          float d = abs(h - centres[i]);
          d = min(d, 1.0 - d);
          float w = exp(-(d * d) * invTwoSigmaSq);
          acc += channels[i] * w;
          wsum += w;
        }
        vec3 shift = acc / max(wsum, 1e-4) + globalShift;

        float newH = fract(h + shift.x * (30.0 / 360.0) + 1.0);
        // Only modulate sat/val for pixels that actually have any
        // chroma; pure greys stay grey (otherwise a saturation
        // boost on a grey image would amplify quantization noise).
        float satGate = smoothstep(0.0, 0.05, s);
        float newS = clamp(s * (1.0 + shift.y * satGate), 0.0, 1.0);
        float newV = clamp(v * (1.0 + shift.z), 0.0, 1.0);
        return hsv2rgb(vec3(newH, newS, newV));
      }

      void main() {
       vec4 src = texture(u_tex, v_uv);

       vec3 col = src.rgb * u_exposure;

        // White balance: temperature shifts the blue<->yellow axis,
        // tint shifts the green<->magenta axis. Implemented as a
        // per-channel GAIN (multiplicative) rather than an additive
        // offset — that's what a real camera WB does, and it's the
        // model Lightroom/Capture One use.
        //
        // Why not additive: an additive shift dumps the same amount
        // onto R/B regardless of brightness, so shadows take a
        // dramatic colour cast (and clamp to zero, losing data
        // irreversibly) while highlights barely move because they
        // clip to 1. A multiplicative gain scales the cast with
        // scene brightness — black stays black, midtones shift
        // proportionally, highlights warm/cool naturally — and the
        // operation is fully reversible.
        //
        // We do this in sRGB rather than linear because the source
        // bitmap is already gamma-encoded (JPEG, or RAW that was
        // developed to sRGB upstream) and the slider feel is what
        // matters here, not colorimetric accuracy.
        //
        // Gain magnitudes: temperature ±0.30 at the extremes
        // (R goes x1.3 / x0.7 at ±100), tint ±0.20 on green with a
        // half-strength counter-shift on R+B so a pure tint move
        // doesn't also change apparent brightness.
        float tempGain = u_temperature * 0.30;
        col.r *= 1.0 + tempGain;
        col.b *= 1.0 - tempGain;
        float tintGain = u_tint * 0.20;
        col.g *= 1.0 + tintGain;
        col.r *= 1.0 - tintGain * 0.5;
        col.b *= 1.0 - tintGain * 0.5;
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

        // Per-photo color (HSL) pass — runs BEFORE the per-photo
        // edit curve so the user sees curve operating on the
        // already-colour-graded image.
        if (u_editColorEnabled == 1) {
          col = applyColor(col, u_editColorChannels, u_editColorGlobal);
        }

        // Per-photo edit curve (after the basic tone math so the
        // user sees the curve operating on the already-graded image).
        if (u_editLutEnabled == 1) {
          col = applyCurveLut(col, u_editLut);
        }

        // Per-photo sharpening — capture detail from the source
        // texture and add it back to the colour-graded result.
        // Computed in source space (independent of tone math) so
        // sliders behave consistently regardless of exposure /
        // contrast. The 0.01 factor maps slider=100 to a 1:1
        // unsharp-mask add, slider=200 to a 2:1 over-sharpen.
        if (u_editSharpenStrength > 0.0) {
          vec3 detail = unsharpDetail(
            u_editSharpenRadius,
            u_editSharpenThreshold
          );
          col += detail * (u_editSharpenStrength * 0.01);
        }

        // ===== POST-PROCESS PASS =====================================
        // Same as the edit pass: colour first, then curve.
        if (u_postColorEnabled == 1) {
          col = applyColor(col, u_postColorChannels, u_postColorGlobal);
        }
        if (u_postLutEnabled == 1) {
          col = applyCurveLut(col, u_postLut);
        }

        // Global "output" sharpening — applied as the very last
        // pass so it works on top of any look the user dialled in.
        if (u_postSharpenStrength > 0.0) {
          vec3 detail = unsharpDetail(
            u_postSharpenRadius,
            u_postSharpenThreshold
          );
          col += detail * (u_postSharpenStrength * 0.01);
        }

        // Grain is the final overlay. A gentle midtone bias keeps the
        // texture photographic and avoids hard clipping at pure black or
        // white. Both modes are monochrome, so they do not introduce a
        // colour cast.
        if (u_grainAmount > 0.0 || u_grainFine > 0.0) {
          float luma = clamp(dot(col, LUMA), 0.0, 1.0);
          float midtone = sqrt(max(4.0 * luma * (1.0 - luma), 0.0));
          float tonalMask = mix(0.35, 1.0, midtone);
          float noise = 0.0;
          if (u_grainAmount > 0.0) {
            noise += organicGrain() * (u_grainAmount * 0.0035);
          }
          if (u_grainFine > 0.0) {
            noise += fineGrain() * (u_grainFine * 0.00055);
          }
          col += vec3(noise * tonalMask);
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
    this.uniforms.editColorEnabled = gl.getUniformLocation(
      program,
      "u_editColorEnabled"
    );
    this.uniforms.editColorChannels = gl.getUniformLocation(
      program,
      "u_editColorChannels[0]"
    );
    this.uniforms.editColorGlobal = gl.getUniformLocation(
      program,
      "u_editColorGlobal"
    );
    this.uniforms.postColorEnabled = gl.getUniformLocation(
      program,
      "u_postColorEnabled"
    );
    this.uniforms.postColorChannels = gl.getUniformLocation(
      program,
      "u_postColorChannels[0]"
    );
    this.uniforms.postColorGlobal = gl.getUniformLocation(
      program,
      "u_postColorGlobal"
    );
   this.uniforms.editSharpenStrength = gl.getUniformLocation(
     program,
      "u_editSharpenStrength"
    );
    this.uniforms.editSharpenRadius = gl.getUniformLocation(
      program,
      "u_editSharpenRadius"
    );
    this.uniforms.editSharpenThreshold = gl.getUniformLocation(
      program,
      "u_editSharpenThreshold"
    );
    this.uniforms.postSharpenStrength = gl.getUniformLocation(
      program,
      "u_postSharpenStrength"
    );
    this.uniforms.postSharpenRadius = gl.getUniformLocation(
      program,
      "u_postSharpenRadius"
    );
    this.uniforms.postSharpenThreshold = gl.getUniformLocation(
      program,
      "u_postSharpenThreshold"
    );
    this.uniforms.sharpenStep = gl.getUniformLocation(program, "u_sharpenStep");
    this.uniforms.grainTexture = gl.getUniformLocation(
      program,
      "u_grainTexture"
    );
    this.uniforms.grainSize = gl.getUniformLocation(program, "u_grainSize");
    this.uniforms.grainAmount = gl.getUniformLocation(
      program,
      "u_grainAmount"
    );
    this.uniforms.grainFine = gl.getUniformLocation(program, "u_grainFine");
    this.uniforms.sourceSize = gl.getUniformLocation(program, "u_sourceSize");

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
    // Trilinear min filter so the sharpen pass can sample lower mip
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
    this.grainTex = this.createGrainTexture();
    return this.grainTex !== null;
  }

  /** Build the procedural field once. A tiny xorshift generator avoids
   *  millions of calls into Math.random while still producing independent,
   *  evenly-distributed texture values. Averaging four bytes gives the red
   *  and green channels a natural bell-shaped distribution; blue is binary
   *  for the Fine control. */
  private createGrainTexture(): WebGLTexture | null {
    const gl = this.gl!;
    const texture = gl.createTexture();
    if (!texture) return null;
    const data = new Uint8Array(
      GRAIN_TEXTURE_SIZE * GRAIN_TEXTURE_SIZE * 4
    );
    let state = ((Math.random() * 0xffffffff) >>> 0) || 0x6d2b79f5;
    const randomWord = (): number => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };
    const gaussianByte = (): number => {
      const word = randomWord();
      return (
        ((word & 0xff) +
          ((word >>> 8) & 0xff) +
          ((word >>> 16) & 0xff) +
          ((word >>> 24) & 0xff)) >>>
        2
      );
    };
    for (let i = 0; i < data.length; i += 4) {
      data[i] = gaussianByte();
      data[i + 1] = gaussianByte();
      data[i + 2] = (randomWord() & 1) === 0 ? 0 : 255;
      data[i + 3] = 255;
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      GRAIN_TEXTURE_SIZE,
      GRAIN_TEXTURE_SIZE,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data
    );
    gl.generateMipmap(gl.TEXTURE_2D);
    return texture;
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

import type { EffectTexture } from "../shader-effect";
import { buildCurveLutTextureData, defaultCurve, type CurveEdit } from "./curve-settings";

export class CurveLutTexture implements EffectTexture {
  readonly handle: WebGLTexture | null;
  private uploaded: CurveEdit | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.handle = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.handle);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.write(defaultCurve());
  }

  upload(curve: CurveEdit): void {
    if (curve === this.uploaded) return;
    this.write(curve);
    this.uploaded = curve;
  }

  dispose(): void {
    if (this.handle) this.gl.deleteTexture(this.handle);
    this.uploaded = null;
  }

  private write(curve: CurveEdit): void {
    if (!this.handle) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.handle);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, buildCurveLutTextureData(curve));
  }
}

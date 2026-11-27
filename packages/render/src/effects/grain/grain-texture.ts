import type { EffectTexture } from "../shader-effect";

/** The grain shader samples with this size hard-coded. */
export const GRAIN_TEXTURE_SIZE = 1024;

export class GrainTexture implements EffectTexture {
  readonly handle: WebGLTexture | null;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.handle = gl.createTexture();
    if (!this.handle) return;
    gl.bindTexture(gl.TEXTURE_2D, this.handle);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, GRAIN_TEXTURE_SIZE, GRAIN_TEXTURE_SIZE, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, this.noise(),
    );
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  dispose(): void {
    if (this.handle) this.gl.deleteTexture(this.handle);
  }

  private noise(): Uint8Array {
    const data = new Uint8Array(GRAIN_TEXTURE_SIZE * GRAIN_TEXTURE_SIZE * 4);
    let state = ((Math.random() * 0xffffffff) >>> 0) || 0x6d2b79f5;
    const random = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };
    const byteAverage = (value: number) =>
      ((value & 255) + ((value >>> 8) & 255) + ((value >>> 16) & 255) + ((value >>> 24) & 255)) >>> 2;
    for (let index = 0; index < data.length; index += 4) {
      data[index] = byteAverage(random());
      data[index + 1] = byteAverage(random());
      data[index + 2] = (random() & 1) === 0 ? 0 : 255;
      data[index + 3] = 255;
    }
    return data;
  }
}

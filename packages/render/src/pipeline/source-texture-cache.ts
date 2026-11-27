export type ImageSource = ImageBitmap | HTMLCanvasElement | OffscreenCanvas;

/** Uploaded sources with mipmaps, so repeated draws of one photo upload nothing. */
export class SourceTextureCache {
  private readonly textures = new Map<ImageSource, WebGLTexture>();

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly capacity = 2,
  ) {}

  get(source: ImageSource): WebGLTexture | null {
    const cached = this.textures.get(source);
    if (cached) {
      this.textures.delete(source);
      this.textures.set(source, cached);
      return cached;
    }
    const texture = this.upload(source);
    if (!texture) return null;
    this.textures.set(source, texture);
    if (this.textures.size > this.capacity) {
      const [oldestSource, oldestTexture] = this.textures.entries().next().value!;
      this.textures.delete(oldestSource);
      this.gl.deleteTexture(oldestTexture);
    }
    return texture;
  }

  clear(): void {
    for (const texture of this.textures.values()) this.gl.deleteTexture(texture);
    this.textures.clear();
  }

  private upload(source: ImageSource): WebGLTexture | null {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) return null;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    return texture;
  }
}

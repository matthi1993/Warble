import { type AnalogSettings } from "@domain/edits";
import { ANALOG_FRAGMENT_SHADER, ANALOG_VERTEX_SHADER } from "../tools/analog/analog.shader";

interface RenderTarget {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
}

export interface AnalogGeometry {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
  sourceWidth: number;
  sourceHeight: number;
  monochrome: boolean;
}

export class AnalogRenderPass {
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private buffer: WebGLBuffer | null = null;
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>();
  private readonly targets: RenderTarget[] = [];
  private width = 0;
  private height = 0;

  constructor(private readonly gl: WebGL2RenderingContext) {}

  begin(width: number, height: number, layerCount: number): boolean {
    if (!this.program && !this.initialize()) return false;
    if (width !== this.width || height !== this.height) {
      this.releaseTargets();
      this.width = width;
      this.height = height;
    }
    while (this.targets.length < layerCount) {
      const target = this.createTarget();
      if (!target) {
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
        this.releaseTargets();
        return false;
      }
      this.targets.push(target);
    }
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.targets[0].framebuffer);
    return true;
  }

  finish(layers: readonly AnalogSettings[], geometry: AnalogGeometry): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform1i(this.uniform("u_edited"), 0);
    gl.uniform2f(this.uniform("u_srcOffset"), geometry.offsetX, geometry.offsetY);
    gl.uniform2f(this.uniform("u_srcScale"), geometry.scaleX, geometry.scaleY);
    gl.uniform2f(this.uniform("u_inputSize"), this.width, this.height);
    const longestSide = Math.max(geometry.sourceWidth, geometry.sourceHeight);
    gl.uniform2f(this.uniform("u_photoAspect"), geometry.sourceWidth / longestSide, geometry.sourceHeight / longestSide);
    gl.uniform1i(this.uniform("u_monochrome"), geometry.monochrome ? 1 : 0);
    for (let index = 0; index < layers.length; index++) {
      const last = index === layers.length - 1;
      gl.bindFramebuffer(gl.FRAMEBUFFER, last ? null : this.targets[index + 1].framebuffer);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.targets[index].texture);
      const needsBlur = layers[index].halation > 0;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, needsBlur ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      if (needsBlur) gl.generateMipmap(gl.TEXTURE_2D);
      for (const [key, value] of Object.entries(layers[index])) {
        gl.uniform1f(this.uniform(`u_${key}`), value / 100);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }

  releaseTargets(): void {
    for (const target of this.targets) {
      this.gl.deleteTexture(target.texture);
      this.gl.deleteFramebuffer(target.framebuffer);
    }
    this.targets.length = 0;
    this.width = 0;
    this.height = 0;
  }

  dispose(): void {
    this.releaseTargets();
    if (this.program) this.gl.deleteProgram(this.program);
    if (this.vao) this.gl.deleteVertexArray(this.vao);
    if (this.buffer) this.gl.deleteBuffer(this.buffer);
    this.program = null;
    this.vao = null;
    this.buffer = null;
    this.uniforms.clear();
  }

  private createTarget(): RenderTarget | null {
    const gl = this.gl;
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) {
      if (texture) gl.deleteTexture(texture);
      if (framebuffer) gl.deleteFramebuffer(framebuffer);
      return null;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteTexture(texture);
      gl.deleteFramebuffer(framebuffer);
      console.error("Could not allocate analog render target");
      return null;
    }
    return { texture, framebuffer };
  }

  private uniform(name: string): WebGLUniformLocation | null {
    if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.program!, name));
    return this.uniforms.get(name) ?? null;
  }

  private initialize(): boolean {
    const gl = this.gl;
    const vertex = this.compile(gl.VERTEX_SHADER, ANALOG_VERTEX_SHADER);
    const fragment = this.compile(gl.FRAGMENT_SHADER, ANALOG_FRAGMENT_SHADER);
    const program = vertex && fragment ? gl.createProgram() : null;
    if (program) {
      gl.attachShader(program, vertex!);
      gl.attachShader(program, fragment!);
      gl.linkProgram(program);
    }
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    if (!program) return false;
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("Analog shader link failed", gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return false;
    }
    this.program = program;
    this.vao = gl.createVertexArray();
    this.buffer = gl.createBuffer();
    if (!this.vao || !this.buffer) {
      this.dispose();
      return false;
    }
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    return true;
  }

  private compile(type: number, source: string): WebGLShader | null {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("Analog shader compilation failed", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }
}

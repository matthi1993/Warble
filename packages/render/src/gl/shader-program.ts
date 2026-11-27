export class ShaderProgram {
  private readonly locations = new Map<string, WebGLUniformLocation | null>();

  private constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly handle: WebGLProgram,
  ) {}

  static create(
    gl: WebGL2RenderingContext,
    vertexSource: string,
    fragmentSource: string,
    label: string,
  ): ShaderProgram | null {
    const vertex = ShaderProgram.compile(gl, gl.VERTEX_SHADER, vertexSource, label);
    const fragment = ShaderProgram.compile(gl, gl.FRAGMENT_SHADER, fragmentSource, label);
    const program = vertex && fragment ? gl.createProgram() : null;
    if (program) {
      gl.attachShader(program, vertex!);
      gl.attachShader(program, fragment!);
      gl.linkProgram(program);
    }
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    if (!program) return null;
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(`${label} shader link failed:`, gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }
    return new ShaderProgram(gl, program);
  }

  use(): void {
    this.gl.useProgram(this.handle);
  }

  attribute(name: string): number {
    return this.gl.getAttribLocation(this.handle, name);
  }

  set1f(name: string, value: number): void {
    this.gl.uniform1f(this.location(name), value);
  }

  set1i(name: string, value: number): void {
    this.gl.uniform1i(this.location(name), value);
  }

  set2f(name: string, x: number, y: number): void {
    this.gl.uniform2f(this.location(name), x, y);
  }

  set3f(name: string, x: number, y: number, z: number): void {
    this.gl.uniform3f(this.location(name), x, y, z);
  }

  set3fv(name: string, value: Float32Array): void {
    this.gl.uniform3fv(this.location(name), value);
  }

  dispose(): void {
    this.gl.deleteProgram(this.handle);
    this.locations.clear();
  }

  private location(name: string): WebGLUniformLocation | null {
    if (!this.locations.has(name)) {
      this.locations.set(name, this.gl.getUniformLocation(this.handle, name));
    }
    return this.locations.get(name) ?? null;
  }

  private static compile(
    gl: WebGL2RenderingContext,
    type: number,
    source: string,
    label: string,
  ): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(`${label} shader compile failed:`, gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }
}

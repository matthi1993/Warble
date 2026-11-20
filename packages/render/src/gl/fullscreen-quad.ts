const TWO_TRIANGLES = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

export class FullscreenQuad {
  private readonly vertexArray: WebGLVertexArrayObject | null;
  private readonly buffer: WebGLBuffer | null;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    positionAttribute: number,
  ) {
    this.vertexArray = gl.createVertexArray();
    this.buffer = gl.createBuffer();
    gl.bindVertexArray(this.vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, TWO_TRIANGLES, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(positionAttribute);
    gl.vertexAttribPointer(positionAttribute, 2, gl.FLOAT, false, 0, 0);
  }

  get ready(): boolean {
    return !!this.vertexArray && !!this.buffer;
  }

  bind(): void {
    this.gl.bindVertexArray(this.vertexArray);
  }

  draw(): void {
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    if (this.vertexArray) this.gl.deleteVertexArray(this.vertexArray);
    if (this.buffer) this.gl.deleteBuffer(this.buffer);
  }
}

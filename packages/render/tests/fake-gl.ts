type Handle = { id: number };

export interface RecordedDraw {
  framebuffer: Handle | null;
  texture: Handle | undefined;
  program: Handle | null;
  uniforms: Map<string, unknown>;
}

/** Records the WebGL calls the pipeline makes; unknown constants resolve to their own name. */
export class FakeGl {
  readonly draws: RecordedDraw[] = [];
  readonly uploads: Array<{ texture: Handle | undefined; data: unknown }> = [];
  readonly mipmaps: Array<Handle | undefined> = [];
  readonly deletedTextures: Handle[] = [];
  readonly deletedFramebuffers: Handle[] = [];
  readonly unitBindings: Array<{ unit: number; texture: Handle }> = [];
  private readonly bound = new Map<number, Handle>();
  private readonly uniforms = new Map<string, unknown>();
  private framebuffer: Handle | null = null;
  private program: Handle | null = null;
  private activeUnit = 0;
  private nextId = 0;

  get context(): WebGL2RenderingContext {
    const handle = () => ({ id: ++this.nextId });
    const calls: Record<string, unknown> = {
      TEXTURE0: 0,
      createShader: handle,
      createProgram: handle,
      createVertexArray: handle,
      createBuffer: handle,
      createTexture: handle,
      createFramebuffer: handle,
      getShaderParameter: () => true,
      getProgramParameter: () => true,
      getAttribLocation: () => 0,
      getUniformLocation: (_program: Handle, name: string) => name,
      checkFramebufferStatus: () => "FRAMEBUFFER_COMPLETE",
      activeTexture: (unit: number) => { this.activeUnit = unit; },
      bindTexture: (_target: unknown, texture: Handle) => {
        this.bound.set(this.activeUnit, texture);
        this.unitBindings.push({ unit: this.activeUnit, texture });
      },
      texImage2D: (...args: unknown[]) => this.uploads.push({ texture: this.bound.get(this.activeUnit), data: args[args.length - 1] }),
      generateMipmap: () => this.mipmaps.push(this.bound.get(this.activeUnit)),
      deleteTexture: (texture: Handle) => this.deletedTextures.push(texture),
      deleteFramebuffer: (target: Handle) => this.deletedFramebuffers.push(target),
      bindFramebuffer: (_target: unknown, framebuffer: Handle | null) => { this.framebuffer = framebuffer; },
      useProgram: (program: Handle) => { this.program = program; },
      uniform1f: (name: string, value: number) => this.uniforms.set(name, value),
      uniform1i: (name: string, value: number) => this.uniforms.set(name, value),
      uniform2f: (name: string, ...values: number[]) => this.uniforms.set(name, values),
      uniform3f: (name: string, ...values: number[]) => this.uniforms.set(name, values),
      uniform3fv: (name: string, values: Float32Array) => this.uniforms.set(name, values),
      drawArrays: () => this.draws.push({
        framebuffer: this.framebuffer,
        texture: this.bound.get(0),
        program: this.program,
        uniforms: new Map(this.uniforms),
      }),
    };
    return new Proxy(calls, {
      get: (target, key: string) => (key in target ? target[key] : /^[A-Z0-9_]+$/.test(key) ? key : () => undefined),
    }) as unknown as WebGL2RenderingContext;
  }

  canvas(): HTMLCanvasElement {
    const context = this.context;
    return { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
  }
}

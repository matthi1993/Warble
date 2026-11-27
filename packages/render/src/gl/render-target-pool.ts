import { RenderTarget } from "./render-target";

/** Intermediate frames between stages, kept across draws while the size is stable. */
export class RenderTargetPool {
  private readonly targets: RenderTarget[] = [];
  private width = 0;
  private height = 0;

  constructor(private readonly gl: WebGL2RenderingContext) {}

  ensure(count: number, width: number, height: number): readonly RenderTarget[] | null {
    if (count === 0) {
      this.release();
      return this.targets;
    }
    if (width !== this.width || height !== this.height) {
      this.release();
      this.width = width;
      this.height = height;
    }
    while (this.targets.length < count) {
      const target = RenderTarget.create(this.gl, width, height);
      if (!target) {
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
        this.release();
        return null;
      }
      this.targets.push(target);
    }
    return this.targets;
  }

  release(): void {
    for (const target of this.targets) target.dispose();
    this.targets.length = 0;
    this.width = 0;
    this.height = 0;
  }
}

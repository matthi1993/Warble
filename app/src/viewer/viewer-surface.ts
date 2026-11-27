import type { Size } from "@warble/render";

export interface Point {
  x: number;
  y: number;
}

/** The canvas element the viewer paints on, measured in device pixels. */
export class ViewerSurface {
  private element: HTMLCanvasElement | null = null;
  private measured: Size | null = null;
  private screenWasLandscape: boolean | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeFrame: number | null = null;
  private onResize: () => void = () => {};

  attach(canvas: HTMLCanvasElement): void {
    this.element = canvas;
  }

  get attached(): boolean {
    return this.element !== null;
  }

  get canvas(): HTMLCanvasElement {
    if (!this.element) throw new Error("the viewer canvas is not attached");
    return this.element;
  }

  get pixelRatio(): number {
    return window.devicePixelRatio || 1;
  }

  get size(): Size {
    return { width: this.canvas.width, height: this.canvas.height };
  }

  get screenLandscape(): boolean {
    return window.innerWidth >= window.innerHeight;
  }

  point(clientX: number, clientY: number): Point {
    const bounds = this.canvas.getBoundingClientRect();
    return { x: (clientX - bounds.left) * this.pixelRatio, y: (clientY - bounds.top) * this.pixelRatio };
  }

  /**
   * Matches the backing store to the laid-out size. Returns `null` while the
   * canvas has no size, otherwise whether the canvas or the screen changed
   * between landscape and portrait.
   */
  measure(): { turned: boolean } | null {
    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    const width = Math.max(1, Math.floor(bounds.width * this.pixelRatio));
    const height = Math.max(1, Math.floor(bounds.height * this.pixelRatio));
    const screenLandscape = this.screenLandscape;
    const canvasTurned =
      !!this.measured && (this.measured.width >= this.measured.height) !== (width >= height);
    const screenTurned = this.screenWasLandscape !== null && this.screenWasLandscape !== screenLandscape;
    this.measured = { width, height };
    this.screenWasLandscape = screenLandscape;
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    return { turned: canvasTurned || screenTurned };
  }

  observe(onResize: () => void): void {
    this.onResize = onResize;
    this.resizeObserver = new ResizeObserver(() => onResize());
    this.resizeObserver.observe(this.canvas);
    window.addEventListener("resize", this.onWindowResize);
    window.addEventListener("orientationchange", this.onWindowResize);
    window.visualViewport?.addEventListener("resize", this.onWindowResize);
  }

  disconnect(): void {
    this.resizeObserver?.disconnect();
    window.removeEventListener("resize", this.onWindowResize);
    window.removeEventListener("orientationchange", this.onWindowResize);
    window.visualViewport?.removeEventListener("resize", this.onWindowResize);
    if (this.resizeFrame !== null) cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = null;
    this.measured = null;
  }

  private readonly onWindowResize = (): void => {
    if (this.resizeFrame !== null) cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = null;
      this.onResize();
    });
  };
}

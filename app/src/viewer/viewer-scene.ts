import {
  EMPTY_RECIPE,
  ImageView,
  RenderQuality,
  ViewLayout,
  Viewport,
  type ImageRenderer,
  type ImageSource,
  type Overlay,
  type Rect,
  type ViewportBounds,
} from "@warble/render";
import type { ImageSources } from "./image-sources";
import type { ViewerEdits } from "./viewer-edits";
import type { ViewerGeometry } from "./viewer-geometry";
import type { ViewerSettings } from "./viewer-settings";
import type { Point, ViewerSurface } from "./viewer-surface";

export interface ViewerPipeline extends ImageRenderer {
  warmup(source: ImageSource): void;
  releaseSources(): void;
  dispose(): void;
}

const NO_SIZE = { width: 0, height: 0 };

export class ViewerScene {
  readonly viewport = new Viewport();
  readonly quality = new RenderQuality(() => this.requestRedraw());
  private view: ImageView | null = null;
  private redrawRequested = false;

  constructor(
    private readonly settings: ViewerSettings,
    readonly surface: ViewerSurface,
    private readonly sources: ImageSources,
    private readonly edits: ViewerEdits,
    readonly geometry: ViewerGeometry,
    readonly pipeline: ViewerPipeline,
    private readonly overlays: () => readonly Overlay[],
  ) {}

  attach(canvas: HTMLCanvasElement): void {
    this.surface.attach(canvas);
    const context = canvas.getContext("2d");
    this.view = context ? new ImageView(context, this.pipeline) : null;
  }

  get hasImage(): boolean {
    return this.sources.current !== null;
  }

  layout(): ViewLayout | null {
    if (!this.surface.attached) return null;
    const { frameSize, proofingSize } = this.settings;
    return new ViewLayout(this.surface.size, frameSize, proofingSize, this.surface.pixelRatio);
  }

  bounds(): ViewportBounds {
    const layout = this.layout();
    if (!layout) return { canvas: NO_SIZE, view: NO_SIZE, image: null };
    return { canvas: layout.canvas, view: layout.view, image: this.geometry.image()?.region ?? null };
  }

  fit(): void {
    this.viewport.fit(this.settings.sizing, this.bounds());
  }

  showImage(): void {
    this.fit();
    this.redraw();
  }

  resize(): void {
    if (!this.surface.attached) return;
    const measured = this.surface.measure();
    if (!measured) return;
    if (measured.turned) this.viewport.forceFit();
    this.showImage();
  }

  /** Coalesces repaints into one per animation frame. */
  requestRedraw(): void {
    if (this.redrawRequested) return;
    this.redrawRequested = true;
    requestAnimationFrame(() => this.redraw());
  }

  redraw(): void {
    this.redrawRequested = false;
    const layout = this.layout();
    if (!this.view || !layout) return;
    const image = this.geometry.image();
    this.view.draw({
      image,
      recipe: image ? this.edits.recipe() : EMPTY_RECIPE,
      viewport: this.viewport,
      layout,
      style: this.settings,
      renderScale: this.quality.scale,
      overlays: image ? this.overlays() : [],
    });
  }

  /** Uploads the sources to the GPU ahead of the first edit, when the browser is idle. */
  warmup(): void {
    if (!this.settings.editing) return;
    const source = this.geometry.image()?.source;
    if (!source) return;
    const upload = () => {
      if (!this.settings.editing || this.geometry.image()?.source !== source) return;
      this.pipeline.warmup(source);
      const preview = this.sources.hd ? this.geometry.rotated(this.sources.hd) : null;
      if (preview && preview !== source) this.pipeline.warmup(preview);
    };
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(upload);
    else setTimeout(upload, 0);
  }

  /** Swaps the shown source and keeps a zoomed image at its on-screen size. */
  upgradeSource(install: () => void): void {
    const previousWidth = this.geometry.image()?.source.width ?? 0;
    install();
    if (this.viewport.userInteracted && previousWidth > 0) {
      const width = this.geometry.image()?.source.width ?? 0;
      if (width > 0 && width !== previousWidth) {
        this.viewport.scale = (this.viewport.scale * previousWidth) / width;
      }
    }
    this.fit();
    this.requestRedraw();
    this.warmup();
  }

  releaseImage(): void {
    this.pipeline.releaseSources();
    this.geometry.releaseRotations();
    this.geometry.releasePresentation();
    this.quality.reset();
  }

  /** The image's rectangle on the canvas in device pixels. */
  imageRect(): Rect | null {
    const image = this.surface.attached ? this.geometry.image() : null;
    return image ? this.viewport.imageRect(this.surface.size, image.region) : null;
  }

  /** A pointer position in normalised image coordinates, which may lie outside 0..1. */
  imagePoint(clientX: number, clientY: number): Point | null {
    const rect = this.imageRect();
    if (!rect) return null;
    const point = this.surface.point(clientX, clientY);
    return { x: (point.x - rect.x) / rect.width, y: (point.y - rect.y) / rect.height };
  }

  isOverImage(clientX: number, clientY: number): boolean {
    const layout = this.layout();
    const rect = this.imageRect();
    if (!layout || !rect) return false;
    const { x, y } = this.surface.point(clientX, clientY);
    return (
      x >= Math.max(layout.inset, rect.x) &&
      x <= Math.min(layout.canvas.width - layout.inset, rect.x + rect.width) &&
      y >= Math.max(layout.inset, rect.y) &&
      y <= Math.min(layout.canvas.height - layout.inset, rect.y + rect.height)
    );
  }
}

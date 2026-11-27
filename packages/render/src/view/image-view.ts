import type { DisplayImage } from "../geometry/image-geometry";
import type { Rect, Size } from "../geometry/rect";
import type { ImageSmoothingQuality } from "../geometry/source-rotator";
import type { RenderRequest } from "../pipeline/render-pipeline";
import type { RenderRecipe } from "../recipe/render-recipe";
import type { Overlay } from "./overlays/overlay";
import type { ViewLayout } from "./view-layout";
import type { Viewport } from "./viewport";
import { visibleRegion } from "./visible-region";

export type RenderedImage = CanvasImageSource & Size;

/** The part of `RenderPipeline` a view or exporter needs. */
export interface ImageRenderer {
  changesImage(recipe: RenderRecipe): boolean;
  render(request: RenderRequest): RenderedImage | null;
}

export interface FrameStyle {
  readonly background: string;
  readonly frameColor: string;
  /** CSS pixels. */
  readonly frameRadius: number;
  readonly smoothingQuality: ImageSmoothingQuality;
}

export interface ViewFrame {
  readonly image: DisplayImage | null;
  readonly recipe: RenderRecipe;
  readonly viewport: Viewport;
  readonly layout: ViewLayout;
  readonly style: FrameStyle;
  /** 1 renders every visible pixel; less renders fewer and scales them up. */
  readonly renderScale: number;
  readonly overlays: readonly Overlay[];
}

export class ImageView {
  constructor(
    private readonly context: CanvasRenderingContext2D,
    private readonly renderer: ImageRenderer,
  ) {}

  draw(frame: ViewFrame): void {
    const context = this.context;
    const { canvas } = frame.layout;
    context.save();
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (frame.style.background && frame.style.background !== "transparent") {
      context.fillStyle = frame.style.background;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    if (frame.image) this.drawImage(frame, frame.image);
    context.restore();
  }

  private drawImage(frame: ViewFrame, image: DisplayImage): void {
    const context = this.context;
    const { layout, style } = frame;
    const placed = frame.viewport.imageRect(layout.canvas, image.region);
    const left = Math.max(layout.inset, placed.x);
    const top = Math.max(layout.inset, placed.y);
    const right = Math.min(layout.canvas.width - layout.inset, placed.x + placed.width);
    const bottom = Math.min(layout.canvas.height - layout.inset, placed.y + placed.height);
    if (right <= left || bottom <= top) return;
    const framed = layout.frameInset > 0;
    if (framed) {
      context.fillStyle = style.frameColor;
      context.fillRect(
        left - layout.frameInset,
        top - layout.frameInset,
        right - left + 2 * layout.frameInset,
        bottom - top + 2 * layout.frameInset,
      );
    }
    context.save();
    context.beginPath();
    context.roundRect(left, top, right - left, bottom - top, framed ? style.frameRadius * layout.pixelRatio : 0);
    context.clip();
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = style.smoothingQuality;
    this.paintImage(frame, image, placed);
    for (const overlay of frame.overlays) overlay.paint(context, placed, layout.pixelRatio);
    context.restore();
  }

  private paintImage(frame: ViewFrame, image: DisplayImage, placed: Rect): void {
    if (!this.renderer.changesImage(frame.recipe)) {
      this.paintUnedited(image, placed);
      return;
    }
    const visible = visibleRegion(placed, frame.layout.canvas, image.region);
    if (!visible) return;
    const rendered = this.renderer.render({
      source: image.source,
      recipe: frame.recipe,
      region: visible.source,
      outputWidth: Math.max(1, Math.ceil(visible.output.width * frame.renderScale)),
      outputHeight: Math.max(1, Math.ceil(visible.output.height * frame.renderScale)),
      effectSize: visible.output,
    });
    if (!rendered) {
      this.paintUnedited(image, placed);
      return;
    }
    const { target } = visible;
    this.context.drawImage(rendered, 0, 0, rendered.width, rendered.height, target.x, target.y, target.width, target.height);
  }

  private paintUnedited(image: DisplayImage, placed: Rect): void {
    const { source, region } = image;
    this.context.drawImage(
      source,
      region.x,
      region.y,
      region.width,
      region.height,
      placed.x,
      placed.y,
      placed.width,
      placed.height,
    );
  }
}

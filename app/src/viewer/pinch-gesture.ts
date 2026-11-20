import type { ViewerScene } from "./viewer-scene";
import type { Point } from "./viewer-surface";

/** A two-finger zoom that keeps the image point under the fingers' midpoint in place. */
export class PinchGesture {
  private readonly distance: number;
  private readonly scale: number;
  private readonly imageCenter: Point;
  private readonly midpoint: Point;

  constructor(
    private readonly scene: ViewerScene,
    first: Point,
    second: Point,
  ) {
    const { viewport, surface } = scene;
    const canvas = surface.size;
    this.distance = spread(first, second);
    this.scale = viewport.scale;
    this.imageCenter = { x: canvas.width / 2 + viewport.offsetX, y: canvas.height / 2 + viewport.offsetY };
    this.midpoint = midpointOnCanvas(scene, first, second);
  }

  /** Returns whether the viewport changed. */
  moveTo(first: Point, second: Point): boolean {
    const { viewport, surface } = this.scene;
    const canvas = surface.size;
    const midpoint = midpointOnCanvas(this.scene, first, second);
    const scale = Math.min(
      viewport.maxScale(surface.pixelRatio),
      Math.max(viewport.minScale, this.scale * (spread(first, second) / this.distance)),
    );
    const ratio = scale / this.scale;
    const centerX = midpoint.x - (this.midpoint.x - this.imageCenter.x) * ratio;
    const centerY = midpoint.y - (this.midpoint.y - this.imageCenter.y) * ratio;
    const changed = viewport.place(
      scale,
      centerX - canvas.width / 2,
      centerY - canvas.height / 2,
      this.scene.bounds(),
    );
    if (changed) viewport.userInteracted = !viewport.isFitting;
    return changed;
  }
}

function spread(first: Point, second: Point): number {
  return Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
}

function midpointOnCanvas(scene: ViewerScene, first: Point, second: Point): Point {
  return scene.surface.point((first.x + second.x) / 2, (first.y + second.y) / 2);
}

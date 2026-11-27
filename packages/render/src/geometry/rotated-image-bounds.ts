import type { CropFrame } from "./crop-frame";
import type { Size } from "./rect";

const UPRIGHT_EPSILON = 1e-6;
const EDGE_TOLERANCE_PX = 0.5;
const SEARCH_STEPS = 24;

/**
 * Where the original image lies inside the bounding box of its rotated copy.
 * Crop frames are normalised to that bounding box.
 */
export class RotatedImageBounds {
  private readonly radians: number;

  constructor(
    private readonly original: Size,
    private readonly rotated: Size,
    rotationDegrees: number,
  ) {
    this.radians = (rotationDegrees * Math.PI) / 180;
  }

  contains(frame: CropFrame): boolean {
    if (Math.abs(this.radians) < UPRIGHT_EPSILON) return true;
    const cos = Math.cos(this.radians);
    const sin = Math.sin(this.radians);
    const halfWidth = this.original.width / 2 + EDGE_TOLERANCE_PX;
    const halfHeight = this.original.height / 2 + EDGE_TOLERANCE_PX;
    const corners = [
      [frame.x, frame.y],
      [frame.x + frame.width, frame.y],
      [frame.x + frame.width, frame.y + frame.height],
      [frame.x, frame.y + frame.height],
    ];
    return corners.every(([cornerX, cornerY]) => {
      const x = cornerX * this.rotated.width - this.rotated.width / 2;
      const y = cornerY * this.rotated.height - this.rotated.height / 2;
      return Math.abs(x * cos + y * sin) <= halfWidth && Math.abs(-x * sin + y * cos) <= halfHeight;
    });
  }

  /** `proposed` if it fits, otherwise the frame closest to it on the way from `fallback`. */
  constrain(proposed: CropFrame, fallback: CropFrame): CropFrame {
    if (this.contains(proposed) || !this.contains(fallback)) return proposed;
    const between = (t: number): CropFrame => ({
      x: fallback.x + (proposed.x - fallback.x) * t,
      y: fallback.y + (proposed.y - fallback.y) * t,
      width: fallback.width + (proposed.width - fallback.width) * t,
      height: fallback.height + (proposed.height - fallback.height) * t,
    });
    let inside = 0;
    let outside = 1;
    for (let step = 0; step < SEARCH_STEPS; step++) {
      const middle = (inside + outside) / 2;
      if (this.contains(between(middle))) inside = middle;
      else outside = middle;
    }
    return between(inside);
  }

  /** The largest centred frame of `aspect` (width / height) that shows no blank corners. */
  largestFrame(aspect: number | null): CropFrame {
    const locked = !!aspect && Number.isFinite(aspect) && aspect > 0 ? aspect : null;
    const size = Math.abs(this.radians) > UPRIGHT_EPSILON ? this.inscribedSize(locked) : this.uprightSize(locked);
    const width = Math.min(1, size.width / this.rotated.width);
    const height = Math.min(1, size.height / this.rotated.height);
    return { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
  }

  private uprightSize(aspect: number | null): Size {
    const { width, height } = this.rotated;
    if (!aspect) return { width, height };
    return aspect >= width / height ? { width, height: width / aspect } : { width: height * aspect, height };
  }

  private inscribedSize(aspect: number | null): Size {
    const cos = Math.abs(Math.cos(this.radians));
    const sin = Math.abs(Math.sin(this.radians));
    const { width: imageWidth, height: imageHeight } = this.original;
    if (aspect) {
      const halfHeight = Math.min(
        imageWidth / (2 * (aspect * cos + sin)),
        imageHeight / (2 * (aspect * sin + cos)),
      );
      return { width: aspect * (2 * halfHeight), height: 2 * halfHeight };
    }
    const denominator = Math.max(1e-6, cos * cos - sin * sin);
    const halfWidth = Math.max(0, (imageWidth * cos - imageHeight * sin) / (2 * denominator));
    const halfHeight = Math.max(0, (imageHeight * cos - imageWidth * sin) / (2 * denominator));
    const width = 2 * Math.min(halfWidth, this.rotated.width / 2);
    const height = 2 * Math.min(halfHeight, this.rotated.height / 2);
    // Near 45° the inscribed rectangle degenerates.
    if (!(width > 0) || !(height > 0)) {
      return { width: this.rotated.width * 0.7, height: this.rotated.height * 0.7 };
    }
    return { width, height };
  }
}

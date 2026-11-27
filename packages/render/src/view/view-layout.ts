import type { Size } from "../geometry/rect";

/** The proofing margin and the frame around the image, in device pixels. */
export class ViewLayout {
  readonly proofingInset: number;
  readonly frameInset: number;

  constructor(
    readonly canvas: Size,
    frameSize: number,
    proofingSize: number,
    readonly pixelRatio: number,
  ) {
    const available = Math.max(0, (Math.min(canvas.width, canvas.height) - 1) / 2);
    this.proofingInset = Math.min(proofingSize * pixelRatio, available);
    this.frameInset = Math.min(
      frameSize * pixelRatio,
      Math.max(0, (Math.min(canvas.width, canvas.height) - 1) / 2 - this.proofingInset),
    );
  }

  get inset(): number {
    return this.proofingInset + this.frameInset;
  }

  get view(): Size {
    return {
      width: Math.max(1, this.canvas.width - 2 * this.inset),
      height: Math.max(1, this.canvas.height - 2 * this.inset),
    };
  }
}

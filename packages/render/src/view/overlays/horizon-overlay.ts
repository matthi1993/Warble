import type { Rect } from "../../geometry/rect";
import type { Overlay } from "./overlay";

const COLOR = "rgba(255, 230, 90, 0.95)";

/** Two points in normalised image coordinates. */
export interface HorizonLine {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export class HorizonOverlay implements Overlay {
  constructor(private readonly line: HorizonLine) {}

  paint(context: CanvasRenderingContext2D, image: Rect, pixelRatio: number): void {
    const ends = [
      [image.x + this.line.ax * image.width, image.y + this.line.ay * image.height],
      [image.x + this.line.bx * image.width, image.y + this.line.by * image.height],
    ];
    context.save();
    context.strokeStyle = COLOR;
    context.lineWidth = 2 * pixelRatio;
    context.setLineDash([6 * pixelRatio, 4 * pixelRatio]);
    context.beginPath();
    context.moveTo(ends[0][0], ends[0][1]);
    context.lineTo(ends[1][0], ends[1][1]);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = COLOR;
    for (const [x, y] of ends) {
      context.beginPath();
      context.arc(x, y, 3 * pixelRatio, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }
}

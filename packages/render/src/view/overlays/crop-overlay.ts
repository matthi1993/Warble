import type { CropFrame } from "../../geometry/crop-frame";
import type { Rect } from "../../geometry/rect";
import type { Overlay } from "./overlay";

const MASK = "rgba(0, 0, 0, 0.55)";
const BORDER = "rgba(255, 255, 255, 0.85)";
const GUIDES = "rgba(255, 255, 255, 0.3)";
const HANDLES = "rgba(255, 255, 255, 0.95)";
const HANDLE_WIDTH = 3;
const HANDLE_LENGTH = 20;

export class CropOverlay implements Overlay {
  constructor(private readonly frame: CropFrame) {}

  paint(context: CanvasRenderingContext2D, image: Rect, pixelRatio: number): void {
    const frame: Rect = {
      x: image.x + this.frame.x * image.width,
      y: image.y + this.frame.y * image.height,
      width: this.frame.width * image.width,
      height: this.frame.height * image.height,
    };
    this.paintMask(context, image, frame);
    context.save();
    this.paintBorderAndThirds(context, frame, pixelRatio);
    context.strokeStyle = HANDLES;
    context.lineWidth = HANDLE_WIDTH * pixelRatio;
    context.lineCap = "round";
    this.paintEdgeBars(context, frame, pixelRatio);
    this.paintCorners(context, frame, pixelRatio);
    context.restore();
  }

  private paintMask(context: CanvasRenderingContext2D, image: Rect, frame: Rect): void {
    context.save();
    context.fillStyle = MASK;
    context.beginPath();
    context.rect(image.x, image.y, image.width, image.height);
    context.rect(frame.x, frame.y, frame.width, frame.height);
    context.fill("evenodd");
    context.restore();
  }

  private paintBorderAndThirds(context: CanvasRenderingContext2D, frame: Rect, pixelRatio: number): void {
    context.strokeStyle = BORDER;
    context.lineWidth = pixelRatio;
    context.strokeRect(frame.x, frame.y, frame.width, frame.height);
    context.strokeStyle = GUIDES;
    context.beginPath();
    for (let third = 1; third <= 2; third++) {
      const x = frame.x + (frame.width * third) / 3;
      context.moveTo(x, frame.y);
      context.lineTo(x, frame.y + frame.height);
      const y = frame.y + (frame.height * third) / 3;
      context.moveTo(frame.x, y);
      context.lineTo(frame.x + frame.width, y);
    }
    context.stroke();
  }

  private paintEdgeBars(context: CanvasRenderingContext2D, frame: Rect, pixelRatio: number): void {
    const horizontal = Math.max(HANDLE_LENGTH * pixelRatio, frame.width / 3);
    const vertical = Math.max(HANDLE_LENGTH * pixelRatio, frame.height / 3);
    const centerX = frame.x + frame.width / 2;
    const centerY = frame.y + frame.height / 2;
    const right = frame.x + frame.width;
    const bottom = frame.y + frame.height;
    context.beginPath();
    context.moveTo(centerX - horizontal / 2, frame.y);
    context.lineTo(centerX + horizontal / 2, frame.y);
    context.moveTo(centerX - horizontal / 2, bottom);
    context.lineTo(centerX + horizontal / 2, bottom);
    context.moveTo(frame.x, centerY - vertical / 2);
    context.lineTo(frame.x, centerY + vertical / 2);
    context.moveTo(right, centerY - vertical / 2);
    context.lineTo(right, centerY + vertical / 2);
    context.stroke();
  }

  private paintCorners(context: CanvasRenderingContext2D, frame: Rect, pixelRatio: number): void {
    const length = Math.min(HANDLE_LENGTH * pixelRatio, frame.width / 4, frame.height / 4);
    const right = frame.x + frame.width;
    const bottom = frame.y + frame.height;
    context.beginPath();
    context.moveTo(frame.x, frame.y + length);
    context.lineTo(frame.x, frame.y);
    context.lineTo(frame.x + length, frame.y);
    context.moveTo(right - length, frame.y);
    context.lineTo(right, frame.y);
    context.lineTo(right, frame.y + length);
    context.moveTo(right, bottom - length);
    context.lineTo(right, bottom);
    context.lineTo(right - length, bottom);
    context.moveTo(frame.x + length, bottom);
    context.lineTo(frame.x, bottom);
    context.lineTo(frame.x, bottom - length);
    context.stroke();
  }
}

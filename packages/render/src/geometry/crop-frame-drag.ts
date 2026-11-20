import { enforceAspect } from "./crop-aspect";
import type { CropFrame, CropHandle, CropResizeHandle } from "./crop-frame";
import { clamp, type Size } from "./rect";

const MIN_FRAME_SIZE = 0.02;
const CORNERS: readonly CropHandle[] = ["ne", "nw", "se", "sw"];

export interface CropDragResult {
  readonly frame: CropFrame;
  /** A corner drag crossed between landscape and portrait, so the aspect was inverted. */
  readonly orientationFlipped: boolean;
}

/** One drag of a crop frame handle, in normalised image coordinates. */
export class CropFrameDrag {
  constructor(
    readonly handle: CropHandle,
    private readonly startX: number,
    private readonly startY: number,
    readonly startFrame: CropFrame,
  ) {}

  moveTo(x: number, y: number, aspect: number | null, image: Size): CropDragResult {
    const dx = x - this.startX;
    const dy = y - this.startY;
    const start = this.startFrame;
    if (this.handle === "move") {
      const frame = {
        ...start,
        x: clamp(start.x + dx, 0, 1 - start.width),
        y: clamp(start.y + dy, 0, 1 - start.height),
      };
      return { frame, orientationFlipped: false };
    }
    const resized = this.resize(this.handle, dx, dy);
    if (!isAspect(aspect)) return { frame: resized, orientationFlipped: false };
    const orientationFlipped =
      aspect !== 1 && CORNERS.includes(this.handle) && isLandscape(start, image) !== isLandscape(resized, image);
    const frame = enforceAspect(resized, start, orientationFlipped ? 1 / aspect : aspect, this.handle, image);
    return { frame, orientationFlipped };
  }

  private resize(handle: CropResizeHandle, dx: number, dy: number): CropFrame {
    const start = this.startFrame;
    let left = start.x;
    let top = start.y;
    let right = start.x + start.width;
    let bottom = start.y + start.height;
    if (handle.includes("w")) left = clamp(start.x + dx, 0, right - MIN_FRAME_SIZE);
    if (handle.includes("e")) right = clamp(start.x + start.width + dx, left + MIN_FRAME_SIZE, 1);
    if (handle.includes("n")) top = clamp(start.y + dy, 0, bottom - MIN_FRAME_SIZE);
    if (handle.includes("s")) bottom = clamp(start.y + start.height + dy, top + MIN_FRAME_SIZE, 1);
    return { x: left, y: top, width: right - left, height: bottom - top };
  }
}

function isAspect(aspect: number | null): aspect is number {
  return !!aspect && Number.isFinite(aspect) && aspect > 0;
}

function isLandscape(frame: CropFrame, image: Size): boolean {
  return frame.width * image.width >= frame.height * image.height;
}

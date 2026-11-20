/** A crop rectangle in normalised image coordinates (0..1). */
export interface CropFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CropResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export type CropHandle = "move" | CropResizeHandle;

import type { EditorCanvas } from "@warble/editing";

export interface FullViewCanvas extends EditorCanvas {
  readonly path: string | null;
  readonly imageReady: boolean;
  resetView(): void;
  reloadSource(): void;
  exportJpeg(): Promise<Uint8Array>;
  beginEditInteraction(): void;
  endEditInteraction(): void;
}

export type CanvasAccessor = () => FullViewCanvas | null;

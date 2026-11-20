import type { ImageSizing, ImageSmoothingQuality } from "@warble/render";

export type ViewerCursor = "" | "move" | "ns" | "ew" | "nwse" | "nesw" | "horizon";

export interface ViewerSettings {
  readonly path: string | null;
  readonly presenting: boolean;
  readonly frameSize: number;
  readonly proofingSize: number;
  readonly frameColor: string;
  readonly frameRadius: number;
  readonly sizing: ImageSizing;
  readonly autoRotate: boolean;
  readonly smoothingQuality: ImageSmoothingQuality;
  readonly background: string;
  readonly cropMode: boolean;
  readonly editing: boolean;
  readonly enableFullRes: boolean;
  readonly cropAspect: number | null;
  readonly rotation: number;
  readonly horizonMode: boolean;
  readonly previewOriginal: boolean;
  cursor: ViewerCursor;
}

export interface ViewerHost extends ViewerSettings {
  readonly style: { setProperty(name: string, value: string): void };
  dispatchEvent(event: Event): boolean;
  requestUpdate(): void;
}

export type ChangedSettings = { has(name: keyof ViewerSettings): boolean };

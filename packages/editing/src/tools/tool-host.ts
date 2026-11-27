import type { LayerId } from "@warble/render";

export type ToolScope = LayerId;
export type EditorImageSizing = "fit" | "fill" | "hybrid";

export interface EditorCanvas {
  getCropFrame(): {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
}

export interface ToolHost {
  /** Path of the displayed file (the resolved variant); edits attach to it. */
  readonly editTarget: string | null;
  readonly canvas: EditorCanvas | null;
  requestUpdate(): void;
  revealEditPanel(): void;
  flushActiveEdit(): Promise<void> | void;
  /** Tells the host which tool owns the canvas, or `null` when none does. */
  setActiveTool(toolId: string | null): void;
}

export interface ToolCanvasOverrides {
  cropMode?: boolean;
  cropAspect?: number | null;
  rotation?: number;
  horizonMode?: boolean;
  sizing?: EditorImageSizing;
}

/** The part of a keyboard event tools need; a DOM `KeyboardEvent` satisfies it. */
export interface ToolKeyEvent {
  readonly key: string;
  preventDefault(): void;
  stopImmediatePropagation(): void;
}

/**
 * Tauri-IPC service for persisting the user's view-state preferences
 * (full-view background, frame and sizing). Backed by
 * the `app_settings` SQLite row keyed by `view_state`.
 */
import { invoke } from "@tauri-apps/api/core";

export type BgColor = "black" | "grey" | "white";
export const FRAME_SIZES = [0, 6, 12, 24, 48] as const;
export const FRAME_RADII = [0, 8, 20] as const;
export type FrameSize = (typeof FRAME_SIZES)[number];
export type FrameRadius = (typeof FRAME_RADII)[number];
export type SizingMode = "fit" | "fill" | "hybrid";
export type SmoothingQuality = "low" | "medium" | "high";

export interface ViewState {
  bg: BgColor;
  frameSize: FrameSize;
  frameColor: BgColor;
  frameRadius: FrameRadius;
  sizing: SizingMode;
  smoothing: SmoothingQuality;
}

export const DEFAULT_VIEW_STATE: ViewState = {
  bg: "black",
  frameSize: 0,
  frameColor: "white",
  frameRadius: 0,
  sizing: "fit",
  smoothing: "high",
};

interface PersistedViewState {
  bg?: string | null;
  fit?: string | null;
  frameSize?: number | null;
  frameColor?: string | null;
  frameRadius?: number | null;
  sizing?: string | null;
  smoothing?: string | null;
}

function coerceBg(v: string | null | undefined): BgColor | null {
  return v === "black" || v === "grey" || v === "white" ? v : null;
}
function coerceFrameSize(v: number | null | undefined): FrameSize | null {
  return FRAME_SIZES.find((size) => size === v) ?? null;
}
function coerceFrameRadius(v: number | null | undefined): FrameRadius | null {
  return FRAME_RADII.find((radius) => radius === v) ?? null;
}
function coerceSizing(v: string | null | undefined): SizingMode | null {
  return v === "fit" || v === "fill" || v === "hybrid" ? v : null;
}
function coerceSmoothing(v: string | null | undefined): SmoothingQuality | null {
  return v === "low" || v === "medium" || v === "high" ? v : null;
}

export async function loadViewState(): Promise<Partial<ViewState>> {
  try {
    const persisted = await invoke<PersistedViewState | null>("get_view_state");
    if (!persisted) return {};
    return {
      ...(coerceBg(persisted.bg) ? { bg: coerceBg(persisted.bg)! } : {}),
      frameSize: coerceFrameSize(persisted.frameSize)
        ?? (persisted.fit === "tight" ? 12 : persisted.fit === "proof" ? 48 : 0),
      frameColor: coerceBg(persisted.frameColor) ?? DEFAULT_VIEW_STATE.frameColor,
      frameRadius: coerceFrameRadius(persisted.frameRadius) ?? DEFAULT_VIEW_STATE.frameRadius,
      ...(coerceSizing(persisted.sizing)
        ? { sizing: coerceSizing(persisted.sizing)! }
        : {}),
      ...(coerceSmoothing(persisted.smoothing)
        ? { smoothing: coerceSmoothing(persisted.smoothing)! }
        : {}),
    };
  } catch (err) {
    console.warn("Failed to load view state", err);
    return {};
  }
}

export async function saveViewState(view: ViewState): Promise<void> {
  try {
    await invoke("set_view_state", { view });
  } catch (err) {
    console.warn("Failed to persist view state", err);
  }
}

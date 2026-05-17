/**
 * Tauri-IPC service for persisting the user's view-state preferences
 * (full-view background colour, fit margin, sizing mode). Backed by
 * the `app_settings` SQLite row keyed by `view_state`.
 */
import { invoke } from "@tauri-apps/api/core";

export type BgColor = "black" | "grey" | "white";
export type FitMode = "contain" | "tight" | "proof";
export type SizingMode = "fit" | "fill" | "hybrid";

export interface ViewState {
  bg: BgColor;
  fit: FitMode;
  sizing: SizingMode;
}

export const DEFAULT_VIEW_STATE: ViewState = {
  bg: "black",
  fit: "contain",
  sizing: "fit",
};

interface PersistedViewState {
  bg?: string | null;
  fit?: string | null;
  sizing?: string | null;
}

function coerceBg(v: string | null | undefined): BgColor | null {
  return v === "black" || v === "grey" || v === "white" ? v : null;
}
function coerceFit(v: string | null | undefined): FitMode | null {
  return v === "contain" || v === "tight" || v === "proof" ? v : null;
}
function coerceSizing(v: string | null | undefined): SizingMode | null {
  return v === "fit" || v === "fill" || v === "hybrid" ? v : null;
}

export async function loadViewState(): Promise<Partial<ViewState>> {
  try {
    const persisted = await invoke<PersistedViewState | null>("get_view_state");
    if (!persisted) return {};
    return {
      ...(coerceBg(persisted.bg) ? { bg: coerceBg(persisted.bg)! } : {}),
      ...(coerceFit(persisted.fit) ? { fit: coerceFit(persisted.fit)! } : {}),
      ...(coerceSizing(persisted.sizing)
        ? { sizing: coerceSizing(persisted.sizing)! }
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

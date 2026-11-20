import type { SettingsBackend } from "../platform/settings-backend";

export type BgColor = "black" | "grey" | "white";
export const FRAME_SIZES = [0, 6, 12, 24, 48] as const;
export const PROOFING_SIZES = [0, 12, 24, 48, 96] as const;
export const FRAME_RADII = [0, 8, 20] as const;
export type FrameSize = (typeof FRAME_SIZES)[number];
export type ProofingSize = (typeof PROOFING_SIZES)[number];
export type FrameRadius = (typeof FRAME_RADII)[number];
export type SizingMode = "fit" | "fill" | "hybrid";
export type SmoothingQuality = "low" | "medium" | "high";

export interface ViewState {
  bg: BgColor;
  proofingSize: ProofingSize;
  frameSize: FrameSize;
  frameColor: BgColor;
  frameRadius: FrameRadius;
  sizing: SizingMode;
  autoRotate: boolean;
  smoothing: SmoothingQuality;
}

export const DEFAULT_VIEW_STATE: ViewState = {
  bg: "black",
  proofingSize: 0,
  frameSize: 0,
  frameColor: "white",
  frameRadius: 0,
  sizing: "fit",
  autoRotate: false,
  smoothing: "high",
};

/** Includes the legacy `fit` field and the old "auto" sizing value. */
export interface PersistedViewState {
  bg?: string | null;
  proofingSize?: number | null;
  fit?: string | null;
  frameSize?: number | null;
  frameColor?: string | null;
  frameRadius?: number | null;
  sizing?: string | null;
  autoRotate?: boolean | null;
  smoothing?: string | null;
}

export class ViewStateStore {
  constructor(private readonly backend: SettingsBackend) {}

  async load(): Promise<Partial<ViewState>> {
    try {
      const persisted = await this.backend.getViewState();
      return persisted ? this.migrate(persisted) : {};
    } catch (error) {
      console.warn("Failed to load view state", error);
      return {};
    }
  }

  async save(view: ViewState): Promise<void> {
    try {
      await this.backend.setViewState(view);
    } catch (error) {
      console.warn("Failed to persist view state", error);
    }
  }

  private migrate(persisted: PersistedViewState): Partial<ViewState> {
    const bg = this.color(persisted.bg);
    const smoothing = this.smoothing(persisted.smoothing);
    const legacyFrameSize = persisted.fit === "tight" ? 12 : persisted.fit === "proof" ? 48 : 0;
    return {
      ...(bg ? { bg } : {}),
      proofingSize: PROOFING_SIZES.find((size) => size === persisted.proofingSize) ?? DEFAULT_VIEW_STATE.proofingSize,
      frameSize: FRAME_SIZES.find((size) => size === persisted.frameSize) ?? legacyFrameSize,
      frameColor: this.color(persisted.frameColor) ?? DEFAULT_VIEW_STATE.frameColor,
      frameRadius: FRAME_RADII.find((radius) => radius === persisted.frameRadius) ?? DEFAULT_VIEW_STATE.frameRadius,
      sizing: this.sizing(persisted.sizing) ?? DEFAULT_VIEW_STATE.sizing,
      autoRotate: persisted.autoRotate ?? persisted.sizing === "auto",
      ...(smoothing ? { smoothing } : {}),
    };
  }

  private color(value: string | null | undefined): BgColor | null {
    return value === "black" || value === "grey" || value === "white" ? value : null;
  }

  private sizing(value: string | null | undefined): SizingMode | null {
    return value === "fit" || value === "fill" || value === "hybrid" ? value : null;
  }

  private smoothing(value: string | null | undefined): SmoothingQuality | null {
    return value === "low" || value === "medium" || value === "high" ? value : null;
  }
}

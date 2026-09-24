/**
 * Render helpers for the full-view toolbar and bottombar.
 *
 * Kept as plain functions instead of web components: their styles
 * live in `<pf-full-view>`'s shadow DOM (see `styles.ts`) and they
 * need access to the host's open-menu state, so a function that
 * returns a `TemplateResult` is the lightest way to extract them
 * without moving CSS.
 */
import { html, type TemplateResult } from "lit";
import type { Photo } from "@domain/photo";
import {
  availableVariants,
  RAW_EXTS,
  type PhotoFormat,
} from "@domain/photo";
import type {
  ImageSizing,
  ImageSmoothingQuality,
} from "@features/image-viewer/pf-image-canvas";
import {
  FRAME_RADII,
  FRAME_SIZES,
  PROOFING_SIZES,
  type BgColor,
  type FrameSize,
  type FrameRadius,
  type ProofingSize,
} from "@services/view-state/view-state-service";

export type FullViewMenu =
  | "bg"
  | "frame"
  | "view"
  | "format"
  | "variant";

export interface ToolbarOptions {
  photo: Photo;
  index: number;
  total: number;
  fullscreen: boolean;
  selection: { format: PhotoFormat; variant: string } | null;
  openMenu: FullViewMenu | null;
  variantHasEdits: (
    photo: Photo,
    format: PhotoFormat,
    variant: string
  ) => boolean;
  onToggleMenu: (which: FullViewMenu) => void;
  onOpenRaw: (path: string) => void;
  onSetVariant: (key: string) => void;
  onDeletePhoto: () => void;
  onOpenIn: () => void;
  deletingPhoto: boolean;
  fileActionBusy: boolean;
  openingIn: boolean;
  openingRaw: boolean;
  showFullscreenToggle: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
}

export function renderToolbar(opts: ToolbarOptions): TemplateResult {
  const { photo, index, total, fullscreen, selection: sel, openMenu } = opts;
  const rawFile = photo.files?.find((file) => RAW_EXTS.includes(file.extension.toLowerCase()));
  const variants = sel !== null ? availableVariants(photo, sel.format) : [];
  return html`
    <div class="toolbar">
      <div class="toolbar-left">
        <span class="filename" title=${photo.filename}>${photo.filename}</span>
        <span class="counter">${index + 1} / ${total}</span>
      </div>
      <div class="toolbar-center">
        ${rawFile ? html`<button
          class="menu-trigger"
          type="button"
          ?disabled=${opts.openingRaw}
          @click=${() => opts.onOpenRaw(rawFile.path)}
        >${opts.openingRaw ? "Opening RAW…" : "Open RAW in…"}</button>` : null}
        ${sel !== null && variants.length >= 1
          ? html`<span class="menu-wrap">
              <button
                class="menu-trigger"
                type="button"
                aria-haspopup="menu"
                aria-expanded=${openMenu === "variant"}
                @click=${() => opts.onToggleMenu("variant")}
              >
                ${variants.find((v) => v.key === sel.variant)?.label ??
                sel.variant}
                ${opts.variantHasEdits(photo, sel.format, sel.variant)
                  ? html`<span class="edit-mark" aria-label="Edited">*</span>`
                  : null}
                <pf-icon name="chevron-down"></pf-icon>
              </button>
              ${openMenu === "variant"
                ? html`<div class="menu-popup" role="menu">
                    ${variants.map(
                      (v) => html`<button
                        class="menu-item"
                        role="menuitemradio"
                        aria-pressed=${sel.variant === v.key}
                        @click=${() => opts.onSetVariant(v.key)}
                      >
                        ${v.label}
                        ${opts.variantHasEdits(photo, sel.format, v.key)
                          ? html`<span class="edit-mark" aria-label="Edited"
                              >*</span
                            >`
                          : null}
                      </button>`
                    )}
                  </div>`
                : null}
            </span>`
          : null}
        <pf-icon-button
          icon="share"
          label=${opts.openingIn ? "Opening…" : "Open In…"}
          ?disabled=${opts.openingIn}
          @click=${opts.onOpenIn}
        ></pf-icon-button>
        <pf-icon-button
          icon="trash"
          danger
          label=${opts.deletingPhoto ? "Moving photo to Bin…" : "Delete photo and all variants (Delete)"}
          ?loading=${opts.deletingPhoto}
          ?disabled=${opts.deletingPhoto || opts.fileActionBusy}
          @click=${opts.onDeletePhoto}
        ></pf-icon-button>
      </div>
      <div class="toolbar-right">
        ${opts.showFullscreenToggle
          ? html`<pf-icon-button
              icon=${fullscreen ? "minimize" : "maximize"}
              label=${fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              @click=${opts.onToggleFullscreen}
            ></pf-icon-button>`
          : null}
        <button
          class="close-btn"
          type="button"
          aria-label="Back to grid"
          title="Back to grid (Esc)"
          @click=${opts.onClose}
          @pointerdown=${(e: Event) => e.stopPropagation()}
        >
          <pf-icon name="grid"></pf-icon>
        </button>
      </div>
    </div>
  `;
}

export interface BottombarOptions {
  bg: BgColor;
  proofingSize: ProofingSize;
  frameSize: FrameSize;
  frameColor: BgColor;
  frameRadius: FrameRadius;
  sizing: ImageSizing;
  smoothing: ImageSmoothingQuality;
  openMenu: FullViewMenu | null;
  bgCss: (bg: BgColor) => string;
  bgLabel: (bg: BgColor) => string;
  onToggleMenu: (which: FullViewMenu) => void;
  onSetBg: (bg: BgColor) => void;
  onSetProofingSize: (size: ProofingSize) => void;
  onSetFrameSize: (size: FrameSize) => void;
  onSetFrameColor: (color: BgColor) => void;
  onSetFrameRadius: (radius: FrameRadius) => void;
  onSetSizing: (s: ImageSizing) => void;
  onSetSmoothing: (q: ImageSmoothingQuality) => void;
  postProcessEnabled: boolean;
  onTogglePostProcess: () => void;
  onPlaySlideshow: () => void;
}

export function renderBottombar(opts: BottombarOptions): TemplateResult {
  const { bg, proofingSize, frameSize, frameColor, frameRadius, sizing, smoothing, openMenu } = opts;
  return html`
    <div class="bottombar">
      <span class="menu-wrap">
        <button
          class="menu-trigger"
          type="button"
          aria-haspopup="menu"
          aria-expanded=${openMenu === "bg"}
          @click=${() => opts.onToggleMenu("bg")}
        >
          <span class="swatch" style="background:${opts.bgCss(bg)}"></span>
          BG Color: ${opts.bgLabel(bg)}
          <pf-icon name="chevron-down"></pf-icon>
        </button>
        ${openMenu === "bg"
          ? html`<div class="menu-popup settings-menu" role="group" aria-label="Background settings">
              <div class="settings-section" role="group" aria-label="Background color">
                <span class="settings-section-label">Color</span>
                <div class="settings-options">
                  ${(["black", "grey", "white"] as BgColor[]).map((b) => html`<button
                    class="menu-item" type="button" aria-pressed=${bg === b}
                    @click=${() => opts.onSetBg(b)}
                  ><span class="swatch" style="background:${opts.bgCss(b)}"></span>${opts.bgLabel(b)}</button>`)}
                </div>
              </div>
              <div class="settings-section" role="group" aria-label="Proofing margin size">
                <span class="settings-section-label">Proofing</span>
                <div class="settings-options">
                  ${PROOFING_SIZES.map((size) => html`<button
                    class="menu-item" type="button" aria-pressed=${proofingSize === size}
                    @click=${() => opts.onSetProofingSize(size)}
                  >${size === 0 ? "None" : `${size}px`}</button>`)}
                </div>
              </div>
            </div>`
          : null}
      </span>
      <span class="menu-wrap">
        <button
          class="menu-trigger"
          type="button"
          aria-haspopup="menu"
          aria-expanded=${openMenu === "frame"}
          @click=${() => opts.onToggleMenu("frame")}
        >
          <span class="swatch" style="background:${opts.bgCss(frameColor)}"></span>
          Frame: ${frameSize === 0 ? "None" : `${frameSize}px`}
          <pf-icon name="chevron-down"></pf-icon>
        </button>
        ${openMenu === "frame" ? html`<div class="menu-popup settings-menu" role="group" aria-label="Frame settings">
          <div class="settings-section" role="group" aria-label="Frame size">
            <span class="settings-section-label">Size</span>
            <div class="settings-options">
              ${FRAME_SIZES.map((size) => html`<button
                class="menu-item" type="button" aria-pressed=${frameSize === size}
                @click=${() => opts.onSetFrameSize(size)}
              >${size === 0 ? "None" : `${size}px`}</button>`)}
            </div>
          </div>
          <div class="settings-section" role="group" aria-label="Frame color">
            <span class="settings-section-label">Color</span>
            <div class="settings-options">
              ${(["white", "grey", "black"] as BgColor[]).map((color) => html`<button
                class="menu-item" type="button" aria-pressed=${frameColor === color}
                @click=${() => opts.onSetFrameColor(color)}
              ><span class="swatch" style="background:${opts.bgCss(color)}"></span>${opts.bgLabel(color)}</button>`)}
            </div>
          </div>
          <div class="settings-section" role="group" aria-label="Inner corner radius">
            <span class="settings-section-label">Inner corners</span>
            <div class="settings-options">
              ${FRAME_RADII.map((radius) => html`<button
                class="menu-item" type="button" aria-pressed=${frameRadius === radius}
                @click=${() => opts.onSetFrameRadius(radius)}
              >${radius === 0 ? "Square" : `${radius}px`}</button>`)}
            </div>
          </div>
        </div>` : null}
      </span>
      <span class="menu-wrap">
        <button
          class="menu-trigger"
          type="button"
          aria-haspopup="menu"
          aria-expanded=${openMenu === "view"}
          @click=${() => opts.onToggleMenu("view")}
        >
          View
          <pf-icon name="chevron-down"></pf-icon>
        </button>
        ${openMenu === "view" ? html`<div class="menu-popup settings-menu view-menu" role="group" aria-label="View settings">
          <div class="settings-section" role="group" aria-label="Scale">
            <span class="settings-section-label">Scale</span>
            <div class="settings-options">
              <button
                class="menu-item"
                type="button"
                aria-pressed=${sizing === "fit"}
                @click=${() => opts.onSetSizing("fit")}
                title="Image fully visible inside the frame"
              >
                Contain
              </button>
              <button
                class="menu-item"
                type="button"
                aria-pressed=${sizing === "fill"}
                @click=${() => opts.onSetSizing("fill")}
                title="Image fills the stage (may crop)"
              >
                Cover
              </button>
              <button
                class="menu-item"
                type="button"
                aria-pressed=${sizing === "hybrid"}
                @click=${() => opts.onSetSizing("hybrid")}
                title="Cover for wide landscape (≥3:2), contain otherwise"
              >
                Hybrid
              </button>
            </div>
          </div>
          <div class="settings-section" role="group" aria-label="Quality">
            <span class="settings-section-label">Quality</span>
            <div class="settings-options">
              ${(["low", "medium", "high"] as ImageSmoothingQuality[]).map((q) => html`<button
                class="menu-item" type="button" aria-pressed=${smoothing === q}
                @click=${() => opts.onSetSmoothing(q)}
              >${q.charAt(0).toUpperCase() + q.slice(1)}</button>`)}
            </div>
          </div>
          <div class="settings-section" role="group" aria-label="Post-Processing">
            <span class="settings-section-label">Post-Processing</span>
            <div class="settings-options">
              <button class="menu-item" type="button" aria-pressed=${opts.postProcessEnabled}
                title="Toggle post-processing (grain, dust, post curve)"
                @click=${opts.onTogglePostProcess}
              >${opts.postProcessEnabled ? "On" : "Off"}</button>
            </div>
          </div>
        </div>` : null}
      </span>
      <button class="menu-trigger" type="button" title="Start slideshow" @click=${opts.onPlaySlideshow}>
        <pf-icon name="play"></pf-icon> Play
      </button>
    </div>
  `;
}

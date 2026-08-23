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
  availableFormats,
  availableVariants,
  type PhotoFormat,
} from "@domain/photo";
import type {
  ImageFit,
  ImageSizing,
  ImageSmoothingQuality,
} from "@ui/photos/pf-image-canvas";
import type { BgColor } from "@services/view-state/view-state-service";

export type FullViewMenu =
  | "bg"
  | "fit"
  | "sizing"
  | "smoothing"
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
  onSetFormat: (f: PhotoFormat) => void;
  onSetVariant: (key: string) => void;
  onToggleFullscreen: () => void;
  onClose: () => void;
}

export function renderToolbar(opts: ToolbarOptions): TemplateResult {
  const { photo, index, total, fullscreen, selection: sel, openMenu } = opts;
  const formats = availableFormats(photo);
  const variants = sel !== null ? availableVariants(photo, sel.format) : [];
  return html`
    <div class="toolbar">
      <div class="toolbar-left">
        <span class="filename" title=${photo.filename}>${photo.filename}</span>
        <span class="counter">${index + 1} / ${total}</span>
      </div>
      <div class="toolbar-center">
        ${sel !== null && formats.length > 1
          ? html`<div
              class="format-switch"
              role="group"
              aria-label="File format"
            >
              ${formats.map(
                (f) => html`<button
                  aria-pressed=${sel.format === f}
                  @click=${() => opts.onSetFormat(f)}
                >
                  ${f}
                </button>`
              )}
            </div>`
          : null}
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
      </div>
      <div class="toolbar-right">
        <pf-icon-button
          icon=${fullscreen ? "minimize" : "maximize"}
          label=${fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          @click=${opts.onToggleFullscreen}
        ></pf-icon-button>
        <button
          class="close-btn"
          type="button"
          aria-label="Close full view"
          title="Close (Esc)"
          @click=${opts.onClose}
          @pointerdown=${(e: Event) => e.stopPropagation()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6 L18 18 M18 6 L6 18" stroke-linecap="round" />
          </svg>
        </button>
      </div>
    </div>
  `;
}

export interface BottombarOptions {
  bg: BgColor;
  fit: ImageFit;
  sizing: ImageSizing;
  smoothing: ImageSmoothingQuality;
  openMenu: FullViewMenu | null;
  bgCss: (bg: BgColor) => string;
  bgLabel: (bg: BgColor) => string;
  fitLabel: (m: ImageFit) => string;
  sizingLabel: (s: ImageSizing) => string;
  smoothingLabel: (q: ImageSmoothingQuality) => string;
  onToggleMenu: (which: FullViewMenu) => void;
  onSetBg: (bg: BgColor) => void;
  onSetFit: (m: ImageFit) => void;
  onSetSizing: (s: ImageSizing) => void;
  onSetSmoothing: (q: ImageSmoothingQuality) => void;
  /** Master post-process switch, shown as a quick toggle next to
   *  "Scale" so the user can flip the global look on/off without
   *  opening the side panel. */
  postProcessEnabled: boolean;
  onTogglePostProcess: () => void;
}

export function renderBottombar(opts: BottombarOptions): TemplateResult {
  const { bg, fit, sizing, smoothing, openMenu } = opts;
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
          ? html`<div class="menu-popup" role="menu">
              ${(["black", "grey", "white"] as BgColor[]).map(
                (b) => html`<button
                  class="menu-item"
                  role="menuitemradio"
                  aria-pressed=${bg === b}
                  @click=${() => opts.onSetBg(b)}
                >
                  <span
                    class="swatch"
                    style="background:${opts.bgCss(b)}"
                  ></span>
                  ${opts.bgLabel(b)}
                </button>`
              )}
            </div>`
          : null}
      </span>
      <span class="menu-wrap">
        <button
          class="menu-trigger"
          type="button"
          aria-haspopup="menu"
          aria-expanded=${openMenu === "fit"}
          @click=${() => opts.onToggleMenu("fit")}
        >
          Margin: ${opts.fitLabel(fit)}
          <pf-icon name="chevron-down"></pf-icon>
        </button>
        ${openMenu === "fit"
          ? html`<div class="menu-popup" role="menu">
              <button
                class="menu-item"
                role="menuitemradio"
                aria-pressed=${fit === "contain"}
                @click=${() => opts.onSetFit("contain")}
                title="No margin — image flush to the panel edges"
              >
                None
              </button>
              <button
                class="menu-item"
                role="menuitemradio"
                aria-pressed=${fit === "tight"}
                @click=${() => opts.onSetFit("tight")}
                title="Tight margin"
              >
                Tight
              </button>
              <button
                class="menu-item"
                role="menuitemradio"
                aria-pressed=${fit === "proof"}
                @click=${() => opts.onSetFit("proof")}
                title="Generous proof margin"
              >
                Proof
              </button>
            </div>`
          : null}
      </span>
      <span class="menu-wrap">
        <button
          class="menu-trigger"
          type="button"
          aria-haspopup="menu"
          aria-expanded=${openMenu === "sizing"}
          @click=${() => opts.onToggleMenu("sizing")}
        >
          Scale: ${opts.sizingLabel(sizing)}
          <pf-icon name="chevron-down"></pf-icon>
        </button>
        ${openMenu === "sizing"
          ? html`<div class="menu-popup" role="menu">
              <button
                class="menu-item"
                role="menuitemradio"
                aria-pressed=${sizing === "fit"}
                @click=${() => opts.onSetSizing("fit")}
                title="Image fully visible inside the margin"
              >
                Contain
              </button>
              <button
                class="menu-item"
                role="menuitemradio"
                aria-pressed=${sizing === "fill"}
                @click=${() => opts.onSetSizing("fill")}
                title="Image fills the stage (may crop)"
              >
                Cover
              </button>
              <button
                class="menu-item"
                role="menuitemradio"
                aria-pressed=${sizing === "hybrid"}
                @click=${() => opts.onSetSizing("hybrid")}
                title="Cover for wide landscape (≥3:2), contain otherwise"
              >
                Hybrid
              </button>
            </div>`
          : null}
     </span>
     <span class="menu-wrap">
       <button
         class="menu-trigger"
         type="button"
         aria-haspopup="menu"
         aria-expanded=${openMenu === "smoothing"}
         @click=${() => opts.onToggleMenu("smoothing")}
       >
         Quality: ${opts.smoothingLabel(smoothing)}
         <pf-icon name="chevron-down"></pf-icon>
       </button>
       ${openMenu === "smoothing"
         ? html`<div class="menu-popup" role="menu">
             ${(["low", "medium", "high"] as ImageSmoothingQuality[]).map(
               (q) => html`<button
                 class="menu-item"
                 role="menuitemradio"
                 aria-pressed=${smoothing === q}
                 @click=${() => opts.onSetSmoothing(q)}
               >
                 ${q.charAt(0).toUpperCase() + q.slice(1)}
               </button>`
             )}
           </div>`
         : null}
     </span>
     <span class="menu-wrap">
       <button
         class="menu-trigger"
         type="button"
         aria-pressed=${opts.postProcessEnabled}
          title="Toggle post-processing (grain, dust, post curve)"
          @click=${opts.onTogglePostProcess}
        >
          Post: ${opts.postProcessEnabled ? "On" : "Off"}
        </button>
      </span>
    </div>
  `;
}

import { html, type TemplateResult } from "lit";
import { PROOFING_SIZES, type BgColor } from "@app/state/view-state-store";
import type { FullViewController } from "./full-view-controller";

const BACKGROUND_COLORS: readonly BgColor[] = ["black", "grey", "white"];

export function renderBackgroundMenu(view: FullViewController): TemplateResult {
  const { viewState, menus } = view;
  const { bg, proofingSize } = viewState.value;
  return html`
    <span class="menu-wrap">
      <button
        class="menu-trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded=${menus.open === "bg"}
        @click=${() => menus.toggle("bg")}
      >
        <span class="swatch" style="background:${viewState.colorCss(bg)}"></span>
        BG Color: ${viewState.colorLabel(bg)}
        <pf-icon name="chevron-down"></pf-icon>
      </button>
      ${menus.open === "bg"
        ? html`<div class="menu-popup settings-menu" role="group" aria-label="Background settings">
            <div class="settings-section" role="group" aria-label="Background color">
              <span class="settings-section-label">Color</span>
              <div class="settings-options">
                ${BACKGROUND_COLORS.map(
                  (color) => html`<button
                    class="menu-item"
                    type="button"
                    aria-pressed=${bg === color}
                    @click=${() => viewState.setBackground(color)}
                  >
                    <span class="swatch" style="background:${viewState.colorCss(color)}"></span
                    >${viewState.colorLabel(color)}
                  </button>`,
                )}
              </div>
            </div>
            <div class="settings-section" role="group" aria-label="Proofing margin size">
              <span class="settings-section-label">Proofing</span>
              <div class="settings-options">
                ${PROOFING_SIZES.map(
                  (size) => html`<button
                    class="menu-item"
                    type="button"
                    aria-pressed=${proofingSize === size}
                    @click=${() => viewState.setProofingSize(size)}
                  >
                    ${size === 0 ? "None" : `${size}px`}
                  </button>`,
                )}
              </div>
            </div>
          </div>`
        : null}
    </span>
  `;
}

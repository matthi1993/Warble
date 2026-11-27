import { html, type TemplateResult } from "lit";
import { FRAME_RADII, FRAME_SIZES, type BgColor } from "@app/state/view-state-store";
import type { FullViewController } from "./full-view-controller";

const FRAME_COLORS: readonly BgColor[] = ["white", "grey", "black"];

export function renderFrameMenu(view: FullViewController): TemplateResult {
  const { viewState, menus } = view;
  const { frameSize, frameColor, frameRadius } = viewState.value;
  return html`
    <span class="menu-wrap">
      <button
        class="menu-trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded=${menus.open === "frame"}
        @click=${() => menus.toggle("frame")}
      >
        <span class="swatch" style="background:${viewState.colorCss(frameColor)}"></span>
        Frame: ${frameSize === 0 ? "None" : `${frameSize}px`}
        <pf-icon name="chevron-down"></pf-icon>
      </button>
      ${menus.open === "frame"
        ? html`<div class="menu-popup settings-menu" role="group" aria-label="Frame settings">
            <div class="settings-section" role="group" aria-label="Frame size">
              <span class="settings-section-label">Size</span>
              <div class="settings-options">
                ${FRAME_SIZES.map(
                  (size) => html`<button
                    class="menu-item"
                    type="button"
                    aria-pressed=${frameSize === size}
                    @click=${() => viewState.setFrameSize(size)}
                  >
                    ${size === 0 ? "None" : `${size}px`}
                  </button>`,
                )}
              </div>
            </div>
            <div class="settings-section" role="group" aria-label="Frame color">
              <span class="settings-section-label">Color</span>
              <div class="settings-options">
                ${FRAME_COLORS.map(
                  (color) => html`<button
                    class="menu-item"
                    type="button"
                    aria-pressed=${frameColor === color}
                    @click=${() => viewState.setFrameColor(color)}
                  >
                    <span class="swatch" style="background:${viewState.colorCss(color)}"></span
                    >${viewState.colorLabel(color)}
                  </button>`,
                )}
              </div>
            </div>
            <div class="settings-section" role="group" aria-label="Inner corner radius">
              <span class="settings-section-label">Inner corners</span>
              <div class="settings-options">
                ${FRAME_RADII.map(
                  (radius) => html`<button
                    class="menu-item"
                    type="button"
                    aria-pressed=${frameRadius === radius}
                    @click=${() => viewState.setFrameRadius(radius)}
                  >
                    ${radius === 0 ? "Square" : `${radius}px`}
                  </button>`,
                )}
              </div>
            </div>
          </div>`
        : null}
    </span>
  `;
}

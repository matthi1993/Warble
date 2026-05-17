/**
 * `pf-crop-card` — crop tool disclosure card. Renders aspect-ratio
 * preset chips, orientation toggle, 90° rotate + horizon-pick
 * buttons, and a fine straighten slider. Pure presentation: emits
 * granular events for the host to apply against the canvas + edit
 * store.
 *
 * Events:
 *  - `aspect-change` with the new {@link AspectRatioKey}
 *  - `orientation-change` with the new {@link Orientation}
 *  - `rotate-90` with `-1` (CCW) or `+1` (CW)
 *  - `horizon-toggle`
 *  - `rotation-change` with the new straighten angle (degrees)
 *  - `crop-reset` when the card-level revert button is clicked
 *  - `toggle` with `{ open }` for the disclosure chevron
 */
import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  ASPECT_RATIO_LABELS,
  type AspectRatioKey,
  type Orientation,
} from "@domain/edits";
import "@ui/cards/pf-card";
import "@ui/controls/pf-slider";
import "@ui/icons/pf-icon";

const ASPECT_OPTIONS: AspectRatioKey[] = [
  "3:2",
  "1:1",
  "4:3",
  "16:9",
  "16:10",
  "panavision",
  "super-panavision",
];

@customElement("pf-crop-card")
export class PfCropCard extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    .edit-group {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 2px;
      background: var(--pf-surface-2);
      border-radius: var(--pf-radius-md);
      flex-wrap: wrap;
    }
    .edit-group button {
      background: transparent;
      color: var(--pf-text);
      border: none;
      padding: 4px 10px;
      font-size: var(--pf-text-xs);
      font-weight: 600;
      border-radius: var(--pf-radius-sm);
      cursor: pointer;
      white-space: nowrap;
    }
    .edit-group button:hover {
      background: var(--pf-surface-hover);
    }
    .edit-group button[aria-pressed="true"] {
      background: var(--pf-accent-soft);
      color: var(--pf-accent);
    }
    .crop-tools-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--pf-space-3);
      margin-top: var(--pf-space-1);
    }
    .crop-tool-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      background: var(--pf-surface-2);
      color: var(--pf-text);
      border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-md);
      cursor: pointer;
      transition:
        background 80ms ease,
        border-color 80ms ease;
    }
    .crop-tool-btn:hover {
      background: var(--pf-surface-hover);
      border-color: var(--pf-accent);
    }
    .crop-tool-btn[aria-pressed="true"] {
      background: var(--pf-accent-soft);
      border-color: var(--pf-accent);
      color: var(--pf-accent);
    }
    .crop-tool-btn pf-icon {
      width: 18px;
      height: 18px;
    }
    .rotation-row {
      display: flex;
      align-items: center;
      gap: var(--pf-space-2);
      margin-top: var(--pf-space-1);
    }
    .rotation-label {
      flex: 0 0 auto;
      font-size: var(--pf-text-xs);
      color: var(--pf-text-muted);
      min-width: 56px;
    }
    .rotation-value {
      flex: 0 0 auto;
      font-variant-numeric: tabular-nums;
      font-size: var(--pf-text-xs);
      min-width: 36px;
      text-align: right;
    }
    .rotation-row pf-slider {
      flex: 1 1 auto;
    }
    .card-revert {
      background: transparent;
      color: var(--pf-text-muted);
      border: none;
      border-left: 1px solid var(--pf-border);
      padding: 0 10px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .card-revert:hover {
      background: var(--pf-surface-hover);
      color: var(--pf-text);
    }
    .card-revert:disabled {
      opacity: 0.35;
      cursor: default;
    }
    .card-revert pf-icon {
      font-size: 0.9rem;
    }
  `;

  @property({ type: Boolean })
  open = false;

  @property({ type: String, attribute: "aspect" })
  aspect: AspectRatioKey = "3:2";

  @property({ type: String, attribute: "orientation" })
  orientation: Orientation = "landscape";

  @property({ type: Number })
  rotation = 0;

  @property({ type: Boolean })
  horizonMode = false;

  @property({ type: Boolean })
  canRevert = false;

  private dispatch(name: string, detail?: unknown) {
    this.dispatchEvent(
      new CustomEvent(name, { detail, bubbles: true, composed: true })
    );
  }

  private onToggle = (e: CustomEvent<{ open: boolean }>) => {
    e.stopPropagation();
    this.dispatch("toggle", e.detail);
  };

  private setAspect = (a: AspectRatioKey) => () =>
    this.dispatch("aspect-change", a);
  private setOrientation = (o: Orientation) => () =>
    this.dispatch("orientation-change", o);
  private onRotate90 = (sign: -1 | 1) => () => this.dispatch("rotate-90", sign);
  private onHorizon = () => this.dispatch("horizon-toggle");
  private onSlider = (e: CustomEvent<number>) => {
    e.stopPropagation();
    this.dispatch("rotation-change", e.detail);
  };
  private onRevert = (e: Event) => {
    e.stopPropagation();
    this.dispatch("crop-reset");
  };

  render() {
    // Slider value = residual fine-straighten in (-45..45], stripping
    // 90° increments stamped in by the rotate buttons so the slider
    // stays centred at 0 after a 90° rotation.
    const r = this.rotation || 0;
    const base = Math.round(r / 90) * 90;
    const sliderValue = Math.max(-45, Math.min(45, r - base));
    return html`
      <pf-card .title=${"Crop"} ?open=${this.open} @toggle=${this.onToggle}>
        <button
          slot="revert"
          type="button"
          class="card-revert"
          title="Revert crop"
          aria-label="Revert crop"
          ?disabled=${!this.canRevert}
          @click=${this.onRevert}
        >
          <pf-icon name="rotate-ccw"></pf-icon>
        </button>
        <div class="edit-group" role="group" aria-label="Aspect ratio">
          ${ASPECT_OPTIONS.map(
            (a) => html`<button
              type="button"
              aria-pressed=${this.aspect === a}
              @click=${this.setAspect(a)}
            >
              ${ASPECT_RATIO_LABELS[a]}
            </button>`
          )}
        </div>
        <div class="edit-group" role="group" aria-label="Orientation">
          <button
            type="button"
            aria-pressed=${this.orientation === "landscape"}
            @click=${this.setOrientation("landscape")}
          >
            Landscape
          </button>
          <button
            type="button"
            aria-pressed=${this.orientation === "portrait"}
            @click=${this.setOrientation("portrait")}
          >
            Portrait
          </button>
        </div>
        <div class="crop-tools-row" role="group" aria-label="Rotate">
          <button
            type="button"
            class="crop-tool-btn"
            title="Rotate 90° left"
            aria-label="Rotate 90° left"
            @click=${this.onRotate90(-1)}
          >
            <pf-icon name="rotate-ccw"></pf-icon>
          </button>
          <button
            type="button"
            class="crop-tool-btn"
            title="Straighten by drawing a horizon line"
            aria-label="Straighten by drawing a horizon line"
            aria-pressed=${this.horizonMode}
            @click=${this.onHorizon}
          >
            <pf-icon name="horizon-line"></pf-icon>
          </button>
          <button
            type="button"
            class="crop-tool-btn"
            title="Rotate 90° right"
            aria-label="Rotate 90° right"
            @click=${this.onRotate90(1)}
          >
            <pf-icon name="rotate-cw"></pf-icon>
          </button>
        </div>
        <div class="rotation-row">
          <span class="rotation-label">Straighten</span>
          <pf-slider
            min="-45"
            max="45"
            step="0.1"
            .value=${sliderValue}
            fillFrom="0"
            @change=${this.onSlider}
          ></pf-slider>
          <span class="rotation-value">${sliderValue.toFixed(1)}°</span>
        </div>
      </pf-card>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-crop-card": PfCropCard;
  }
}

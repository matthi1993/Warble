/**
 * `pf-sharpen-card` — disclosure card with three sliders for the
 * unsharp-mask sharpening effect: strength (0..200%), radius
 * (0.3..3 px), threshold (0..50). Mirrors the shape of
 * `pf-curve-card` / `pf-color-card` — host owns persistence and
 * picks the default value, the card just emits `sharpen-change`
 * / `sharpen-reset` / `toggle`.
 *
 * "Reset" returns the value to whatever the host considers the
 * baseline — for the per-photo edit panel that's the format-
 * specific default (some sharpening on RAW, none on JPG); for the
 * post-process panel it's all zeros. The card itself doesn't know
 * about formats, so the host wires the reset behaviour.
 */
import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  defaultSharpen,
  type SharpenSettings,
} from "@services/effects/effects-store";
import "@ui/cards/pf-card";
import "@ui/controls/pf-slider";
import "@ui/icons/pf-icon";

@customElement("pf-sharpen-card")
export class PfSharpenCard extends LitElement {
  static styles = css`
    :host {
      display: block;
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
    .body {
      padding: 8px 10px 10px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .row {
      display: grid;
      grid-template-columns: 1fr auto;
      column-gap: 8px;
      row-gap: 2px;
      align-items: center;
    }
    .label {
      font-size: var(--pf-text-xs);
      color: var(--pf-text);
      grid-column: 1;
    }
    .value {
      font-size: var(--pf-text-xs);
      color: var(--pf-text-muted);
      font-variant-numeric: tabular-nums;
      grid-column: 2;
      min-width: 3ch;
      text-align: right;
    }
    pf-slider {
      grid-column: 1 / span 2;
      width: 100%;
    }
  `;

  @property({ attribute: false })
  value: SharpenSettings = defaultSharpen();

  @property({ type: Boolean })
  open = false;

  @property()
  title = "Sharpen";

  /** Whether the revert button is enabled. Host decides what
   *  "reverted" means (zeroed vs format default), so it tells us
   *  whether the current value differs from baseline. Defaults to
   *  `value.strength > 0` if not set explicitly. */
  @property({ type: Boolean, attribute: "can-revert" })
  canRevert: boolean | null = null;

  private onToggle = (e: CustomEvent<{ open: boolean }>) => {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent<{ open: boolean }>("toggle", {
        detail: e.detail,
        bubbles: true,
        composed: true,
      })
    );
  };

  private onResetAll = (e: Event) => {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("sharpen-reset", { bubbles: true, composed: true })
    );
  };

  private emit(next: SharpenSettings) {
    this.dispatchEvent(
      new CustomEvent<SharpenSettings>("sharpen-change", {
        detail: next,
        bubbles: true,
        composed: true,
      })
    );
  }

  private onStrength = (e: CustomEvent<number>) => {
    e.stopPropagation();
    this.emit({ ...this.value, strength: e.detail });
  };

  private onRadius = (e: CustomEvent<number>) => {
    e.stopPropagation();
    // Snap to 1 decimal to keep the displayed value stable.
    const r = Math.round(e.detail * 10) / 10;
    this.emit({ ...this.value, radius: r });
  };

  private onThreshold = (e: CustomEvent<number>) => {
    e.stopPropagation();
    this.emit({ ...this.value, threshold: e.detail });
  };

  render() {
    const v = this.value;
    const canRevert =
      this.canRevert == null ? v.strength > 0 : this.canRevert;
    return html`
      <pf-card .title=${this.title} ?open=${this.open} @toggle=${this.onToggle}>
        <button
          slot="revert"
          type="button"
          class="card-revert"
          title="Reset sharpen"
          aria-label="Reset sharpen"
          ?disabled=${!canRevert}
          @click=${this.onResetAll}
        >
          <pf-icon name="rotate-ccw"></pf-icon>
        </button>
        <div class="body">
          <div class="row">
            <span class="label">Strength</span>
            <span class="value">${v.strength}</span>
            <pf-slider
              min="0"
              max="200"
              step="1"
              .value=${v.strength}
              label="Strength"
              fill-from="0"
              @change=${this.onStrength}
            ></pf-slider>
          </div>
          <div class="row">
            <span class="label">Radius</span>
            <span class="value">${v.radius.toFixed(1)}</span>
            <pf-slider
              min="0.3"
              max="3"
              step="0.1"
              .value=${v.radius}
              label="Radius"
              fill-from="0.3"
              @change=${this.onRadius}
            ></pf-slider>
          </div>
          <div class="row">
            <span class="label">Threshold</span>
            <span class="value">${v.threshold}</span>
            <pf-slider
              min="0"
              max="50"
              step="1"
              .value=${v.threshold}
              label="Threshold"
              fill-from="0"
              @change=${this.onThreshold}
            ></pf-slider>
          </div>
        </div>
      </pf-card>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-sharpen-card": PfSharpenCard;
  }
}

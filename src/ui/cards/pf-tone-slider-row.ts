/**
 * `pf-tone-slider-row` — single labelled slider for a tone adjustment
 * (Exposure, Contrast, etc.). Emits `change` with the control value and
 * `reset` when the value chip is double-clicked. Most controls use -100..100;
 */
import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import "../controls/pf-slider";

@customElement("pf-tone-slider-row")
export class PfToneSliderRow extends LitElement {
  static styles = css`
    :host {
      display: grid;
      grid-template-columns: 1fr auto;
      column-gap: 8px;
      row-gap: 2px;
      align-items: center;
    }
    .slider-label {
      font-size: var(--pf-text-xs);
      color: var(--pf-text);
      grid-column: 1;
    }
    .slider-value {
      font-size: var(--pf-text-xs);
      color: var(--pf-text-muted);
      font-variant-numeric: tabular-nums;
      grid-column: 2;
      min-width: 3ch;
      text-align: right;
      cursor: pointer;
    }
    .slider-value:hover {
      color: var(--pf-text);
    }
    pf-slider {
      grid-column: 1 / span 2;
      width: 100%;
    }
  `;

  @property({ type: String })
  label = "";

  @property({ type: Number })
  value = 0;

  @property({ type: Number })
  min = -100;

  @property({ type: Number })
  max = 100;

  @property({ type: Number })
  step = 1;

  @property({ type: Number, attribute: "reset-value" })
  resetValue = 0;

  @property({ type: String, attribute: "value-display" })
  valueDisplay = "";

  private onChange = (e: CustomEvent<number>) => {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent<number>("change", {
        detail: e.detail,
        bubbles: true,
        composed: true,
      })
    );
  };

  private onReset = () => {
    if (this.value === this.resetValue) return;
    this.dispatchEvent(
      new CustomEvent("reset", { bubbles: true, composed: true })
    );
  };

  render() {
    const v = this.value;
    return html`
      <span class="slider-label">${this.label}</span>
      <span
        class="slider-value"
        title="Double-click to reset"
        @dblclick=${this.onReset}
      >
        ${this.valueDisplay || (v > 0 ? `+${v}` : v)}
      </span>
      <pf-slider
        .min=${this.min}
        .max=${this.max}
        .step=${this.step}
        .value=${v}
        .label=${this.label}
        .fillFrom=${this.resetValue}
        @change=${this.onChange}
      ></pf-slider>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-tone-slider-row": PfToneSliderRow;
  }
}

/**
 * `pf-tone-slider-row` — single labelled slider for a tone adjustment
 * (Exposure, Contrast, etc.). Emits `change` with the new value (-100..100)
 * and `reset` when the value chip is double-clicked.
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
    if (this.value === 0) return;
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
        ${v > 0 ? `+${v}` : v}
      </span>
      <pf-slider
        min="-100"
        max="100"
        step="1"
        .value=${v}
        .label=${this.label}
        fill-from="0"
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

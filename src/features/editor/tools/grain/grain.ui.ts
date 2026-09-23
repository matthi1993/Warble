/**
 * Presentational grain controls. The host owns persistence and this UI edits
 * the three user-facing parameters.
 */
import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  defaultGrain,
  type GrainSettings,
} from "@services/effects/effects-store";
import "@ui/cards/pf-card";
import "@ui/controls/pf-slider";
import "@ui/icons/pf-icon";

@customElement("pf-grain-card")
export class PfGrainCard extends LitElement {
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
  value: GrainSettings = defaultGrain();

  @property({ type: Boolean }) effectDisabled = false;

  @property({ type: Boolean })
  open = false;

  @property()
  title = "Grain";

  @property({ type: Boolean, attribute: "can-revert" })
  canRevert: boolean | null = null;

  private onToggle = (event: CustomEvent<{ open: boolean }>) => {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent<{ open: boolean }>("toggle", {
        detail: event.detail,
        bubbles: true,
        composed: true,
      })
    );
  };

  private emit(next: GrainSettings): void {
    this.dispatchEvent(
      new CustomEvent<GrainSettings>("grain-change", {
        detail: next,
        bubbles: true,
        composed: true,
      })
    );
  }

  private onSize = (event: CustomEvent<number>) => {
    event.stopPropagation();
    this.emit({ ...this.value, size: event.detail });
  };

  private onAmount = (event: CustomEvent<number>) => {
    event.stopPropagation();
    this.emit({ ...this.value, amount: event.detail });
  };

  private onFine = (event: CustomEvent<number>) => {
    event.stopPropagation();
    this.emit({ ...this.value, fine: event.detail });
  };

  private onReset = (event: Event) => {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("grain-reset", { bubbles: true, composed: true })
    );
  };

  render() {
    const value = this.value;
    const defaults = defaultGrain();
    const canRevert = this.canRevert ??
      (value.size !== defaults.size ||
        value.amount !== defaults.amount ||
        value.fine !== defaults.fine);
    return html`
      <pf-card .effectDisabled=${this.effectDisabled} .title=${this.title} ?open=${this.open} @toggle=${this.onToggle}>
        <button
          slot="revert"
          type="button"
          class="card-revert"
          title="Reset grain"
          aria-label="Reset grain"
          ?disabled=${!canRevert}
          @click=${this.onReset}
        >
          <pf-icon name="rotate-ccw"></pf-icon>
        </button>
        <div class="body">
          <div class="row">
            <span class="label">Size</span>
            <span class="value">${value.size}</span>
            <pf-slider
              min="0.1"
              max="100"
              step="0.1"
              .value=${value.size}
              label="Grain size"
              fill-from="0.1"
              @change=${this.onSize}
            ></pf-slider>
          </div>
          <div class="row">
            <span class="label">Amount</span>
            <span class="value">${value.amount}</span>
            <pf-slider
              min="0"
              max="100"
              step="1"
              .value=${value.amount}
              label="Grain amount"
              fill-from="0"
              @change=${this.onAmount}
            ></pf-slider>
          </div>
          <div class="row">
            <span class="label">Fine</span>
            <span class="value">${value.fine}</span>
            <pf-slider
              min="0"
              max="100"
              step="1"
              .value=${value.fine}
              label="Fine per-pixel noise"
              fill-from="0"
              @change=${this.onFine}
            ></pf-slider>
          </div>
        </div>
      </pf-card>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-grain-card": PfGrainCard;
  }
}

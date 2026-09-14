/**
 * `pf-basic-card` — tonal adjustments disclosure card. Receives the
 * current `ToneEdit` value and emits granular events when sliders
 * change or are reset. The host owns persistence and store
 * subscription.
 *
 * Events:
 *  - `tone-change` with `{ key, value }` when a slider moves
 *  - `tone-reset-key` with `{ key }` when a value chip is double-clicked
 *  - `tone-reset` when the card-level revert button is clicked
 *  - `toggle` with `{ open }` when the card chevron is clicked
 */
import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  BASE_TONE_KEYS,
  defaultTone,
  isBaseToneZero,
  toneControlSpec,
  type ToneEdit,
} from "@domain/edits";
import "@ui/cards/pf-card";
import "@ui/cards/pf-tone-slider-row";
import "@ui/icons/pf-icon";
import "./dynamic-range.ui";

const TONE_LABELS: Record<keyof ToneEdit, string> = {
  temperature: "Temperature",
  tint: "Tint",
  exposure: "Exposure",
  contrast: "Contrast",
  saturation: "Saturation",
  whites: "Whites",
  highlights: "Highlights",
  shadows: "Shadows",
  blacks: "Blacks",
};

@customElement("pf-basic-card")
export class PfBasicCard extends LitElement {
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
    .card-revert pf-icon {
      font-size: 0.9rem;
    }
  `;

  @property({ attribute: false })
  tone: ToneEdit = defaultTone();

  @property({ type: Boolean })
  open = false;

  @property({ type: Boolean })
  raw = false;

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

  private onSliderChange = (key: keyof ToneEdit) => (e: CustomEvent<number>) => {
    e.stopPropagation();
    const spec = toneControlSpec(key, this.raw);
    this.dispatchEvent(
      new CustomEvent<{ key: keyof ToneEdit; value: number }>("tone-change", {
        detail: { key, value: spec.toModel(e.detail) },
        bubbles: true,
        composed: true,
      })
    );
  };

  private onSliderReset = (key: keyof ToneEdit) => () => {
    this.dispatchEvent(
      new CustomEvent<{ key: keyof ToneEdit }>("tone-reset-key", {
        detail: { key },
        bubbles: true,
        composed: true,
      })
    );
  };

  private onResetAll = (e: Event) => {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("tone-reset", { bubbles: true, composed: true })
    );
  };

  render() {
    const canRevert = !isBaseToneZero(this.tone);
    return html`
      <pf-card before-after .title=${"Base Edit"} ?open=${this.open} @toggle=${this.onToggle}>
        <button
          slot="revert"
          type="button"
          class="card-revert"
          title="Revert base edits"
          aria-label="Revert base edits"
          ?disabled=${!canRevert}
          @click=${this.onResetAll}
        >
          <pf-icon name="rotate-ccw"></pf-icon>
        </button>
        ${BASE_TONE_KEYS.map(
          (key) => {
            const spec = toneControlSpec(key, this.raw);
            return html`
            <pf-tone-slider-row
              .label=${TONE_LABELS[key]}
              .value=${spec.toControl(this.tone[key])}
              .min=${spec.min}
              .max=${spec.max}
              .step=${spec.step}
              .resetValue=${spec.resetValue}
              .valueDisplay=${spec.displayValue(this.tone[key])}
              @change=${this.onSliderChange(key)}
              @reset=${this.onSliderReset(key)}
            ></pf-tone-slider-row>
          `;
          }
        )}
      </pf-card>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-basic-card": PfBasicCard;
  }
}

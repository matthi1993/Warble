/**
 * Secondary dynamic-range UI for the tone tool.
 * sliders that shape an image's dynamic range (Whites / Highlights /
 * Shadows / Blacks). Sibling of `pf-basic-card`; uses the same event
 * contract so `ToneTool` can wire both cards through one set of
 * handlers.
 *
 * Events (identical to `pf-basic-card`):
 *  - `tone-change` with `{ key, value }` when a slider moves
 *  - `tone-reset-key` with `{ key }` when a value chip is double-clicked
 *  - `tone-reset` when the card-level revert button is clicked
 *  - `toggle` with `{ open }` when the card chevron is clicked
 */
import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  DYNAMIC_RANGE_KEYS,
  defaultTone,
  isDynamicRangeZero,
  toneControlSpec,
  type ToneEdit,
} from "@domain/edits";
import "@ui/cards/pf-card";
import "@ui/cards/pf-tone-slider-row";
import "@ui/icons/pf-icon";

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

@customElement("pf-dynamic-range-card")
export class PfDynamicRangeCard extends LitElement {
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
    const spec = toneControlSpec();
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
    const canRevert = !isDynamicRangeZero(this.tone);
    return html`
      <pf-card
        before-after
        .title=${"Dynamic Range"}
        ?open=${this.open}
        @toggle=${this.onToggle}
      >
        <button
          slot="revert"
          type="button"
          class="card-revert"
          title="Revert dynamic range"
          aria-label="Revert dynamic range"
          ?disabled=${!canRevert}
          @click=${this.onResetAll}
        >
          <pf-icon name="rotate-ccw"></pf-icon>
        </button>
        ${DYNAMIC_RANGE_KEYS.map(
          (key) => {
            const spec = toneControlSpec();
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
    "pf-dynamic-range-card": PfDynamicRangeCard;
  }
}

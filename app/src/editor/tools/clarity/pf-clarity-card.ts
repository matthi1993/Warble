import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { defaultClarity, type ClaritySettings } from "@warble/render";
import "@ui/cards/pf-card";
import "@ui/controls/pf-slider";
import "@ui/icons/pf-icon";
import { sliderRowStyles } from "../slider-rows.styles";
import { toolCardStyles } from "../tool-card.styles";

const CONTROLS: ReadonlyArray<{ key: keyof ClaritySettings; label: string; hint: string }> = [
  { key: "clarity", label: "Clarity", hint: "Local contrast in broader details; negative values soften the image." },
  { key: "structure", label: "Structure", hint: "Fine texture contrast; negative values smooth texture." },
];

@customElement("pf-clarity-card")
export class PfClarityCard extends LitElement {
  static styles = [toolCardStyles, sliderRowStyles];

  @property({ attribute: false })
  value: ClaritySettings = defaultClarity();

  @property({ type: Boolean })
  open = false;

  @property({ type: Boolean })
  effectDisabled = false;

  @property({ type: Boolean, attribute: "can-revert" })
  canRevert = false;

  private emitChange(key: keyof ClaritySettings, event: CustomEvent<number>): void {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent<ClaritySettings>("clarity-change", {
        detail: { ...this.value, [key]: event.detail },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private onToggle = (event: CustomEvent<{ open: boolean }>) => {
    event.stopPropagation();
    this.dispatchEvent(new CustomEvent("toggle", { detail: event.detail, bubbles: true, composed: true }));
  };

  private onReset = () => {
    this.dispatchEvent(new CustomEvent("clarity-reset", { bubbles: true, composed: true }));
  };

  render() {
    const defaults = defaultClarity();
    return html`
      <pf-card
        title="Clarity / Structure"
        .effectDisabled=${this.effectDisabled}
        ?open=${this.open}
        @toggle=${this.onToggle}
      >
        <button
          slot="revert"
          type="button"
          class="card-revert"
          title="Reset clarity and structure"
          aria-label="Reset clarity and structure"
          ?disabled=${!this.canRevert}
          @click=${this.onReset}
        >
          <pf-icon name="rotate-ccw"></pf-icon>
        </button>
        <div class="body">
          ${CONTROLS.map(
            ({ key, label, hint }) => html`
              <div class="row" title=${hint}>
                <span class="label">${label}</span>
                <span class="value">${this.value[key]}</span>
                <pf-slider
                  min="-100"
                  max="100"
                  step="1"
                  .value=${this.value[key]}
                  label=${label}
                  fill-from=${defaults[key]}
                  @change=${(event: CustomEvent<number>) => this.emitChange(key, event)}
                ></pf-slider>
              </div>
            `,
          )}
        </div>
      </pf-card>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-clarity-card": PfClarityCard;
  }
}

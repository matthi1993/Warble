import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { defaultBloom, type BloomSettings } from "@warble/render";
import "@ui/cards/pf-card";
import "@ui/controls/pf-slider";
import "@ui/icons/pf-icon";
import { sliderRowStyles, steadyValueWidthStyles } from "../slider-rows.styles";
import { toolCardStyles } from "../tool-card.styles";

const CONTROLS: ReadonlyArray<{ key: keyof BloomSettings; label: string }> = [
  { key: "strength", label: "Bloom" },
  { key: "threshold", label: "Threshold" },
  { key: "radius", label: "Radius" },
  { key: "softness", label: "Softness" },
  { key: "spread", label: "Spread" },
];

@customElement("pf-bloom-card")
export class PfBloomCard extends LitElement {
  static styles = [toolCardStyles, sliderRowStyles, steadyValueWidthStyles];

  @property({ attribute: false })
  value: BloomSettings = defaultBloom();

  @property({ type: Boolean })
  open = false;

  @property({ type: Boolean })
  effectDisabled = false;

  @property()
  title = "Bloom";

  @property({ type: Boolean, attribute: "can-revert" })
  canRevert: boolean | null = null;

  private emitChange(key: keyof BloomSettings, event: CustomEvent<number>): void {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent<BloomSettings>("bloom-change", {
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
    this.dispatchEvent(new CustomEvent("bloom-reset", { bubbles: true, composed: true }));
  };

  private get differsFromDefaults(): boolean {
    const defaults = defaultBloom();
    return CONTROLS.some(({ key }) => this.value[key] !== defaults[key]);
  }

  render() {
    const canRevert = this.canRevert ?? this.differsFromDefaults;
    return html`
      <pf-card
        .effectDisabled=${this.effectDisabled}
        .title=${this.title}
        ?open=${this.open}
        @toggle=${this.onToggle}
      >
        <button
          slot="revert"
          type="button"
          class="card-revert"
          title="Reset bloom"
          aria-label="Reset bloom"
          ?disabled=${!canRevert}
          @click=${this.onReset}
        >
          <pf-icon name="rotate-ccw"></pf-icon>
        </button>
        <div class="body">
          ${CONTROLS.map(
            ({ key, label }) => html`
              <div class="row">
                <span class="label">${label}</span>
                <span class="value">${this.value[key]}</span>
                <pf-slider
                  min="0"
                  max="100"
                  step="1"
                  .value=${this.value[key]}
                  label=${label}
                  fill-from="0"
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
    "pf-bloom-card": PfBloomCard;
  }
}

import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { defaultSharpen, type SharpenSettings } from "@warble/render";
import "@ui/cards/pf-card";
import "@ui/controls/pf-slider";
import "@ui/icons/pf-icon";
import { sliderRowStyles, steadyValueWidthStyles } from "../slider-rows.styles";
import { toolCardStyles } from "../tool-card.styles";

@customElement("pf-sharpen-card")
export class PfSharpenCard extends LitElement {
  static styles = [toolCardStyles, sliderRowStyles, steadyValueWidthStyles];

  @property({ attribute: false })
  value: SharpenSettings = defaultSharpen();

  @property({ type: Boolean })
  effectDisabled = false;

  @property({ type: Boolean })
  open = false;

  @property()
  title = "Sharpen";

  /** The host decides what counts as reverted; without it any strength above zero can be reverted. */
  @property({ type: Boolean, attribute: "can-revert" })
  canRevert: boolean | null = null;

  private onToggle = (event: CustomEvent<{ open: boolean }>) => {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent<{ open: boolean }>("toggle", { detail: event.detail, bubbles: true, composed: true }),
    );
  };

  private onReset = (event: Event) => {
    event.stopPropagation();
    this.dispatchEvent(new CustomEvent("sharpen-reset", { bubbles: true, composed: true }));
  };

  private emitChange(next: SharpenSettings): void {
    this.dispatchEvent(
      new CustomEvent<SharpenSettings>("sharpen-change", { detail: next, bubbles: true, composed: true }),
    );
  }

  private onStrength = (event: CustomEvent<number>) => {
    event.stopPropagation();
    this.emitChange({ ...this.value, strength: event.detail });
  };

  private onRadius = (event: CustomEvent<number>) => {
    event.stopPropagation();
    const oneDecimal = Math.round(event.detail * 10) / 10;
    this.emitChange({ ...this.value, radius: oneDecimal });
  };

  private onThreshold = (event: CustomEvent<number>) => {
    event.stopPropagation();
    this.emitChange({ ...this.value, threshold: event.detail });
  };

  render() {
    const value = this.value;
    const canRevert = this.canRevert == null ? value.strength > 0 : this.canRevert;
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
          title="Reset sharpen"
          aria-label="Reset sharpen"
          ?disabled=${!canRevert}
          @click=${this.onReset}
        >
          <pf-icon name="rotate-ccw"></pf-icon>
        </button>
        <div class="body">
          <div class="row">
            <span class="label">Strength</span>
            <span class="value">${value.strength}</span>
            <pf-slider
              min="0"
              max="200"
              step="1"
              .value=${value.strength}
              label="Strength"
              fill-from="0"
              @change=${this.onStrength}
            ></pf-slider>
          </div>
          <div class="row">
            <span class="label">Radius</span>
            <span class="value">${value.radius.toFixed(1)}</span>
            <pf-slider
              min="0.3"
              max="3"
              step="0.1"
              .value=${value.radius}
              label="Radius"
              fill-from="0.3"
              @change=${this.onRadius}
            ></pf-slider>
          </div>
          <div class="row">
            <span class="label">Threshold</span>
            <span class="value">${value.threshold}</span>
            <pf-slider
              min="0"
              max="50"
              step="1"
              .value=${value.threshold}
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

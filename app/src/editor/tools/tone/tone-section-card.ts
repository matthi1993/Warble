import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import { toneControlSpec } from "@warble/editing";
import { defaultTone, type ToneEdit } from "@warble/render";
import "@ui/cards/pf-card";
import "@ui/cards/pf-tone-slider-row";
import "@ui/icons/pf-icon";
import { toolCardStyles } from "../tool-card.styles";
import { toneSectionCardStyles } from "./tone-section-card.styles";

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

/** A card with one slider per tone key of a section. Both tone cards share one tone value and one event contract. */
export abstract class ToneSectionCard extends LitElement {
  static styles = [toolCardStyles, toneSectionCardStyles];

  @property({ attribute: false })
  tone: ToneEdit = defaultTone();

  @property({ type: Boolean })
  effectDisabled = false;

  @property({ type: Boolean })
  open = false;

  protected abstract readonly heading: string;
  protected abstract readonly revertLabel: string;
  protected abstract readonly toneKeys: readonly (keyof ToneEdit)[];
  protected abstract isNeutral(tone: ToneEdit): boolean;

  private onToggle = (event: CustomEvent<{ open: boolean }>) => {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent<{ open: boolean }>("toggle", { detail: event.detail, bubbles: true, composed: true }),
    );
  };

  private onSliderChange(key: keyof ToneEdit, event: CustomEvent<number>): void {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent<{ key: keyof ToneEdit; value: number }>("tone-change", {
        detail: { key, value: toneControlSpec().toModel(event.detail) },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private onSliderReset(key: keyof ToneEdit): void {
    this.dispatchEvent(
      new CustomEvent<{ key: keyof ToneEdit }>("tone-reset-key", { detail: { key }, bubbles: true, composed: true }),
    );
  }

  private onResetAll = (event: Event) => {
    event.stopPropagation();
    this.dispatchEvent(new CustomEvent("tone-reset", { bubbles: true, composed: true }));
  };

  render() {
    const spec = toneControlSpec();
    return html`
      <pf-card
        .effectDisabled=${this.effectDisabled}
        .title=${this.heading}
        ?open=${this.open}
        @toggle=${this.onToggle}
      >
        <button
          slot="revert"
          type="button"
          class="card-revert"
          title=${this.revertLabel}
          aria-label=${this.revertLabel}
          ?disabled=${this.isNeutral(this.tone)}
          @click=${this.onResetAll}
        >
          <pf-icon name="rotate-ccw"></pf-icon>
        </button>
        ${this.toneKeys.map(
          (key) => html`
            <pf-tone-slider-row
              .label=${TONE_LABELS[key]}
              .value=${spec.toControl(this.tone[key])}
              .min=${spec.min}
              .max=${spec.max}
              .step=${spec.step}
              .resetValue=${spec.resetValue}
              .valueDisplay=${spec.displayValue(this.tone[key])}
              @change=${(event: CustomEvent<number>) => this.onSliderChange(key, event)}
              @reset=${() => this.onSliderReset(key)}
            ></pf-tone-slider-row>
          `,
        )}
      </pf-card>
    `;
  }
}

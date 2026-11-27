import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  COLOR_CHANNELS,
  COLOR_CHANNEL_HUES,
  defaultColor,
  isColorZero,
  type ColorChannel,
  type ColorEdit,
} from "@warble/render";
import "@ui/cards/pf-card";
import "@ui/cards/pf-tone-slider-row";
import "@ui/icons/pf-icon";
import { toolCardStyles } from "../tool-card.styles";
import { ColorCardController, type ColorAxis } from "./color-card-controller";
import { colorCardStyles } from "./pf-color-card.styles";

const AXIS_LABELS: Record<ColorAxis, string> = {
  hue: "Hue",
  saturation: "Saturation",
  luminance: "Luminance",
};

const CHANNEL_LABELS: Record<ColorChannel, string> = {
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  aqua: "Aqua",
  blue: "Blue",
  purple: "Purple",
  magenta: "Magenta",
};

@customElement("pf-color-card")
export class PfColorCard extends LitElement {
  static styles = [toolCardStyles, colorCardStyles];

  @property({ attribute: false })
  value: ColorEdit = defaultColor();

  @property({ type: Boolean })
  effectDisabled = false;

  @property({ type: Boolean })
  open = false;

  @property()
  title = "Color";

  private readonly controller = new ColorCardController({
    currentValue: () => this.value,
    requestUpdate: () => this.requestUpdate(),
    emitChange: (next) =>
      this.dispatchEvent(new CustomEvent<ColorEdit>("color-change", { detail: next, bubbles: true, composed: true })),
  });

  private onToggle = (event: CustomEvent<{ open: boolean }>) => {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent<{ open: boolean }>("toggle", { detail: event.detail, bubbles: true, composed: true }),
    );
  };

  private onResetAll = (event: Event) => {
    event.stopPropagation();
    this.dispatchEvent(new CustomEvent("color-reset", { bubbles: true, composed: true }));
  };

  render() {
    const controller = this.controller;
    const blackAndWhite = this.value.blackAndWhite;
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
          title="Reset all colour adjustments"
          aria-label="Reset all colour adjustments"
          ?disabled=${isColorZero(this.value)}
          @click=${this.onResetAll}
        >
          <pf-icon name="rotate-ccw"></pf-icon>
        </button>
        <div class="body">
          <div class="toggle-row">
            <span class="toggle-label">Black &amp; White</span>
            <button
              type="button"
              class="toggle"
              role="switch"
              aria-pressed=${blackAndWhite ? "true" : "false"}
              aria-label="Toggle black and white"
              title=${blackAndWhite ? "Use color" : "Convert to black and white"}
              @click=${() => controller.toggleBlackAndWhite()}
            ></button>
          </div>
          <div class="tabs" role="tablist" aria-label="Color axis">
            ${(Object.keys(AXIS_LABELS) as ColorAxis[]).map(
              (axis) => html`
                <button
                  type="button"
                  class="tab"
                  role="tab"
                  aria-selected=${controller.axis === axis ? "true" : "false"}
                  @click=${() => controller.selectAxis(axis)}
                >
                  ${AXIS_LABELS[axis]}
                </button>
              `,
            )}
          </div>
          ${COLOR_CHANNELS.map((channel) => this.renderChannelRow(channel))}
          <div class="divider"></div>
          <div class="global-label">All</div>
          <div class="row">
            <span class="swatch" style="background:transparent" aria-hidden="true"></span>
            <pf-tone-slider-row
              .label=${AXIS_LABELS[controller.axis]}
              .value=${controller.globalValue}
              @change=${(event: CustomEvent<number>) => controller.setGlobal(event.detail)}
              @reset=${() => controller.resetGlobal()}
            ></pf-tone-slider-row>
          </div>
        </div>
      </pf-card>
    `;
  }

  private renderChannelRow(channel: ColorChannel) {
    const controller = this.controller;
    return html`
      <div class="row">
        <span
          class="swatch"
          style="background:hsl(${COLOR_CHANNEL_HUES[channel]}, 78%, 55%)"
          aria-hidden="true"
        ></span>
        <pf-tone-slider-row
          .label=${CHANNEL_LABELS[channel]}
          .value=${controller.channelValue(channel)}
          @change=${(event: CustomEvent<number>) => controller.setChannel(channel, event.detail)}
          @reset=${() => controller.resetChannel(channel)}
        ></pf-tone-slider-row>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-color-card": PfColorCard;
  }
}

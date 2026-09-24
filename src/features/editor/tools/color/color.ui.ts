/**
 * Presentational UI for the color tool.
 * Mirrors the shape of `pf-curve-card` (revert button in the header,
 * `toggle` / `color-change` / `color-reset` events). Host owns
 * persistence; the card is identical between the per-photo edit tab
 * and the global post-process tab.
 *
 * Layout:
 *   - H / S / L axis tabs
 *   - 8 per-hue sliders (colour swatch + label + value)
 *   - divider
 *   - "All" global slider for the active axis
 *
 * Each axis is independent so flipping tabs preserves the user's
 * scratch values across H / S / L.
 */
import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  COLOR_CHANNELS,
  COLOR_CHANNEL_HUES,
  defaultColor,
  isColorZero,
  type ColorChannel,
  type ColorChannelEdit,
  type ColorEdit,
} from "@domain/edits";
import "@ui/cards/pf-card";
import "@ui/cards/pf-tone-slider-row";
import "@ui/icons/pf-icon";

type Axis = "hue" | "saturation" | "luminance";

const AXIS_LABELS: Record<Axis, string> = {
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
    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 4px 0;
    }
    .toggle-label {
      font-size: var(--pf-text-sm);
      color: var(--pf-text);
    }
    .toggle {
      position: relative;
      width: 36px;
      height: 20px;
      flex: 0 0 auto;
      border-radius: 999px;
      background: var(--pf-border);
      border: none;
      cursor: pointer;
      padding: 0;
      transition: background 120ms ease;
    }
    .toggle[aria-pressed="true"] {
      background: var(--pf-accent, #4a90e2);
    }
    .toggle::after {
      content: "";
      position: absolute;
      top: 2px;
      left: 2px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: white;
      transition: transform 120ms ease;
    }
    .toggle[aria-pressed="true"]::after {
      transform: translateX(16px);
    }
    .tabs {
      display: flex;
      gap: 4px;
      background: var(--pf-surface);
      border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-sm, 4px);
      padding: 2px;
    }
    .tab {
      flex: 1 1 0;
      font-size: var(--pf-text-xs);
      font-weight: 500;
      color: var(--pf-text-muted);
      background: transparent;
      border: none;
      border-radius: calc(var(--pf-radius-sm, 4px) - 2px);
      padding: 6px 4px;
      cursor: pointer;
      transition: background 80ms ease, color 80ms ease;
    }
    .tab:hover {
      color: var(--pf-text);
    }
    .tab[aria-selected="true"] {
      background: var(--pf-surface-hover);
      color: var(--pf-text);
    }
    .row {
      display: grid;
      grid-template-columns: 12px 1fr;
      column-gap: 8px;
      align-items: center;
    }
    .swatch {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      border: 1px solid rgba(255, 255, 255, 0.18);
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35) inset;
    }
    pf-tone-slider-row {
      min-width: 0;
    }
    .divider {
      height: 1px;
      background: var(--pf-border);
      margin: 2px 0;
    }
    .global-label {
      font-size: var(--pf-text-xs);
      color: var(--pf-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-top: 2px;
    }
  `;

  @property({ attribute: false })
  value: ColorEdit = defaultColor();

  @property({ type: Boolean }) effectDisabled = false;

  @property({ type: Boolean })
  open = false;

  @property()
  title = "Color";

  @state()
  private axis: Axis = "hue";

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

  private onResetAll = (e: Event) => {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("color-reset", { bubbles: true, composed: true })
    );
  };

  private emitChange(next: ColorEdit): void {
    this.dispatchEvent(
      new CustomEvent<ColorEdit>("color-change", {
        detail: next,
        bubbles: true,
        composed: true,
      })
    );
  }

  /** Produce a new ColorEdit with one per-channel axis value swapped. */
  private withChannel(
    channel: ColorChannel,
    axis: Axis,
    value: number
  ): ColorEdit {
    const channels = { ...this.value.channels } as Record<
      ColorChannel,
      ColorChannelEdit
    >;
    channels[channel] = { ...channels[channel], [axis]: value };
    return { ...this.value, channels };
  }

  private setChannelAxis = (
    channel: ColorChannel,
    axis: Axis,
    value: number
  ) => {
    this.emitChange(this.withChannel(channel, axis, value));
  };

  private resetChannelAxis = (channel: ColorChannel, axis: Axis) => {
    if (this.value.channels[channel]?.[axis] === 0) return;
    this.emitChange(this.withChannel(channel, axis, 0));
  };

  private setGlobalAxis = (axis: Axis, value: number) => {
    if (this.value[axis] === value) return;
    this.emitChange({ ...this.value, [axis]: value });
  };

  private resetGlobalAxis = (axis: Axis) => {
    if (this.value[axis] === 0) return;
    this.emitChange({ ...this.value, [axis]: 0 });
  };

  private toggleBlackAndWhite = () => {
    this.emitChange({
      ...this.value,
      blackAndWhite: !this.value.blackAndWhite,
    });
  };

  private selectAxis(axis: Axis) {
    this.axis = axis;
  }

  private swatchColor(channel: ColorChannel): string {
    const hue = COLOR_CHANNEL_HUES[channel];
    return `hsl(${hue}, 78%, 55%)`;
  }

  render() {
    const canRevert = !isColorZero(this.value);
    const axis = this.axis;
    return html`
      <pf-card .effectDisabled=${this.effectDisabled} .title=${this.title} ?open=${this.open} @toggle=${this.onToggle}>
        <button
          slot="revert"
          type="button"
          class="card-revert"
          title="Reset all colour adjustments"
          aria-label="Reset all colour adjustments"
          ?disabled=${!canRevert}
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
              aria-pressed=${this.value.blackAndWhite ? "true" : "false"}
              aria-label="Toggle black and white"
              title=${this.value.blackAndWhite
                ? "Use color"
                : "Convert to black and white"}
              @click=${this.toggleBlackAndWhite}
            ></button>
          </div>
          <div class="tabs" role="tablist" aria-label="Color axis">
            ${(Object.keys(AXIS_LABELS) as Axis[]).map(
              (a) => html`
                <button
                  type="button"
                  class="tab"
                  role="tab"
                  aria-selected=${axis === a ? "true" : "false"}
                  @click=${() => this.selectAxis(a)}
                >
                  ${AXIS_LABELS[a]}
                </button>
              `
            )}
          </div>
          ${COLOR_CHANNELS.map((ch) => {
            const v = this.value.channels[ch]?.[axis] ?? 0;
            return html`
              <div class="row">
                <span
                  class="swatch"
                  style="background:${this.swatchColor(ch)}"
                  aria-hidden="true"
                ></span>
                <pf-tone-slider-row
                  .label=${CHANNEL_LABELS[ch]}
                  .value=${v}
                  @change=${(e: CustomEvent<number>) =>
                    this.setChannelAxis(ch, axis, e.detail)}
                  @reset=${() => this.resetChannelAxis(ch, axis)}
                ></pf-tone-slider-row>
              </div>
            `;
          })}
          <div class="divider"></div>
          <div class="global-label">All</div>
          <div class="row">
            <span class="swatch" style="background:transparent" aria-hidden="true"></span>
            <pf-tone-slider-row
              .label=${AXIS_LABELS[axis]}
              .value=${this.value[axis]}
              @change=${(e: CustomEvent<number>) =>
                this.setGlobalAxis(axis, e.detail)}
              @reset=${() => this.resetGlobalAxis(axis)}
            ></pf-tone-slider-row>
          </div>
        </div>
      </pf-card>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-color-card": PfColorCard;
  }
}

import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ASPECT_RATIO_LABELS, type AspectRatioKey, type Orientation } from "@warble/editing";
import "@ui/cards/pf-card";
import "@ui/controls/pf-slider";
import "@ui/icons/pf-icon";
import { toolCardStyles } from "../tool-card.styles";
import { cropCardStyles } from "./pf-crop-card.styles";

const ASPECT_OPTIONS: AspectRatioKey[] = ["3:2", "1:1", "4:3", "16:9", "16:10", "xpan", "panavision"];
const MAX_STRAIGHTEN_DEGREES = 45;

@customElement("pf-crop-card")
export class PfCropCard extends LitElement {
  static styles = [toolCardStyles, cropCardStyles];

  @property({ type: Boolean })
  open = false;

  @property({ type: Boolean })
  effectDisabled = false;

  @property({ type: String, attribute: "aspect" })
  aspect: AspectRatioKey = "3:2";

  @property({ type: String, attribute: "orientation" })
  orientation: Orientation = "landscape";

  @property({ type: Number })
  rotation = 0;

  @property({ type: Boolean })
  horizonMode = false;

  @property({ type: Boolean })
  canRevert = false;

  private dispatch(name: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private onToggle = (event: CustomEvent<{ open: boolean }>) => {
    event.stopPropagation();
    this.dispatch("toggle", event.detail);
  };

  private onStraighten = (event: CustomEvent<number>) => {
    event.stopPropagation();
    this.dispatch("rotation-change", event.detail);
  };

  private onRevert = (event: Event) => {
    event.stopPropagation();
    this.dispatch("crop-reset");
  };

  /** The slider shows only the fine angle, so it stays centred after a 90° rotation. */
  private get straightenAngle(): number {
    const rotation = this.rotation || 0;
    const quarterTurns = Math.round(rotation / 90) * 90;
    return Math.max(-MAX_STRAIGHTEN_DEGREES, Math.min(MAX_STRAIGHTEN_DEGREES, rotation - quarterTurns));
  }

  render() {
    const straightenAngle = this.straightenAngle;
    return html`
      <pf-card .effectDisabled=${this.effectDisabled} .title=${"Crop"} ?open=${this.open} @toggle=${this.onToggle}>
        <button
          slot="revert"
          type="button"
          class="card-revert"
          title="Revert crop"
          aria-label="Revert crop"
          ?disabled=${!this.canRevert}
          @click=${this.onRevert}
        >
          <pf-icon name="rotate-ccw"></pf-icon>
        </button>
        <div class="edit-group" role="group" aria-label="Aspect ratio">
          ${ASPECT_OPTIONS.map(
            (aspect) => html`<button
              type="button"
              aria-pressed=${this.aspect === aspect}
              @click=${() => this.dispatch("aspect-change", aspect)}
            >
              ${ASPECT_RATIO_LABELS[aspect]}
            </button>`,
          )}
        </div>
        <div class="edit-group" role="group" aria-label="Orientation">
          ${this.renderOrientationButton("landscape", "Landscape")}
          ${this.renderOrientationButton("portrait", "Portrait")}
        </div>
        <div class="crop-tools-row" role="group" aria-label="Rotate">
          <button
            type="button"
            class="crop-tool-btn"
            title="Rotate 90° left"
            aria-label="Rotate 90° left"
            @click=${() => this.dispatch("rotate-90", -1)}
          >
            <pf-icon name="rotate-ccw"></pf-icon>
          </button>
          <button
            type="button"
            class="crop-tool-btn"
            title="Straighten by drawing a horizon line"
            aria-label="Straighten by drawing a horizon line"
            aria-pressed=${this.horizonMode}
            @click=${() => this.dispatch("horizon-toggle")}
          >
            <pf-icon name="horizon-line"></pf-icon>
          </button>
          <button
            type="button"
            class="crop-tool-btn"
            title="Rotate 90° right"
            aria-label="Rotate 90° right"
            @click=${() => this.dispatch("rotate-90", 1)}
          >
            <pf-icon name="rotate-cw"></pf-icon>
          </button>
        </div>
        <div class="rotation-row">
          <span class="rotation-label">Straighten</span>
          <pf-slider
            min="-45"
            max="45"
            step="0.1"
            .value=${straightenAngle}
            fillFrom="0"
            @change=${this.onStraighten}
          ></pf-slider>
          <span class="rotation-value">${straightenAngle.toFixed(1)}°</span>
        </div>
      </pf-card>
    `;
  }

  private renderOrientationButton(orientation: Orientation, label: string) {
    return html`
      <button
        type="button"
        aria-pressed=${this.orientation === orientation}
        @click=${() => this.dispatch("orientation-change", orientation)}
      >
        ${label}
      </button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-crop-card": PfCropCard;
  }
}

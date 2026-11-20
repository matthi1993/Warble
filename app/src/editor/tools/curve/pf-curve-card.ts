import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { defaultCurve, isCurveZero, type CurveEdit } from "@warble/render";
import "@ui/cards/pf-card";
import "@ui/icons/pf-icon";
import { toolCardStyles } from "../tool-card.styles";
import { curveCardStyles } from "./pf-curve-card.styles";
import "./pf-curve-editor";

@customElement("pf-curve-card")
export class PfCurveCard extends LitElement {
  static styles = [toolCardStyles, curveCardStyles];

  @property({ attribute: false })
  value: CurveEdit = defaultCurve();

  @property({ type: Boolean })
  effectDisabled = false;

  @property({ type: Boolean })
  open = false;

  @property()
  title = "Curve";

  private onToggle = (event: CustomEvent<{ open: boolean }>) => {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent<{ open: boolean }>("toggle", { detail: event.detail, bubbles: true, composed: true }),
    );
  };

  private onResetAll = (event: Event) => {
    event.stopPropagation();
    this.dispatchEvent(new CustomEvent("curve-reset", { bubbles: true, composed: true }));
  };

  private onCurveChange = (event: CustomEvent<CurveEdit>) => {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent<CurveEdit>("curve-change", { detail: event.detail, bubbles: true, composed: true }),
    );
  };

  render() {
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
          title="Reset all channels"
          aria-label="Reset all channels"
          ?disabled=${isCurveZero(this.value)}
          @click=${this.onResetAll}
        >
          <pf-icon name="rotate-ccw"></pf-icon>
        </button>
        <div class="body">
          <pf-curve-editor .value=${this.value} @curve-change=${this.onCurveChange}></pf-curve-editor>
        </div>
      </pf-card>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-curve-card": PfCurveCard;
  }
}

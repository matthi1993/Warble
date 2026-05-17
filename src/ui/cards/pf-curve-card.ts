/**
 * `pf-curve-card` — disclosure card wrapping `pf-curve-editor` for
 * the editing-panel "Curve" tool. Mirrors the shape of
 * `pf-basic-card` (revert button in the card header, `toggle` /
 * `curve-change` / `curve-reset` events). Host owns persistence.
 */
import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { defaultCurve, isCurveZero, type CurveEdit } from "@domain/edits";
import "@ui/cards/pf-card";
import "@ui/cards/pf-curve-editor";
import "@ui/icons/pf-icon";

@customElement("pf-curve-card")
export class PfCurveCard extends LitElement {
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
    }
  `;

  @property({ attribute: false })
  value: CurveEdit = defaultCurve();

  @property({ type: Boolean })
  open = false;

  @property()
  title = "Curve";

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
      new CustomEvent("curve-reset", { bubbles: true, composed: true })
    );
  };

  private onCurveChange = (e: CustomEvent<CurveEdit>) => {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent<CurveEdit>("curve-change", {
        detail: e.detail,
        bubbles: true,
        composed: true,
      })
    );
  };

  render() {
    const canRevert = !isCurveZero(this.value);
    return html`
      <pf-card .title=${this.title} ?open=${this.open} @toggle=${this.onToggle}>
        <button
          slot="revert"
          type="button"
          class="card-revert"
          title="Reset all channels"
          aria-label="Reset all channels"
          ?disabled=${!canRevert}
          @click=${this.onResetAll}
        >
          <pf-icon name="rotate-ccw"></pf-icon>
        </button>
        <div class="body">
          <pf-curve-editor
            .value=${this.value}
            @curve-change=${this.onCurveChange}
          ></pf-curve-editor>
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

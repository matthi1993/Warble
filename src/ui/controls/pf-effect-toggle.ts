import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import "../icons/pf-icon";

@customElement("pf-effect-toggle")
export class PfEffectToggle extends LitElement {
  static styles = css`
    :host { display: inline-flex; flex: 0 0 auto; }
    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0 10px;
      min-height: 32px;
      background: transparent;
      color: var(--pf-text-muted);
      border: none;
      border-left: 1px solid var(--pf-border);
      cursor: pointer;
    }
    button:hover { background: var(--pf-surface-hover); color: var(--pf-text); }
    button[aria-pressed="true"] { color: #e88b23; }
    button[aria-pressed="true"]:hover { color: #ff9d30; }
  `;

  @property({ type: Boolean })
  disabled = false;

  @property({ type: String })
  label = "Effect";

  render() {
    const action = `${this.disabled ? "Enable" : "Disable"} ${this.label}`;
    return html`<button
      type="button"
      title=${action}
      aria-label=${action}
      aria-pressed=${this.disabled}
      @click=${(event: Event) => {
        event.stopPropagation();
        this.dispatchEvent(new CustomEvent("effect-toggle", { bubbles: true, composed: true }));
      }}
    ><pf-icon name="power"></pf-icon></button>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-effect-toggle": PfEffectToggle;
  }
}

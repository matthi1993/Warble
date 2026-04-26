import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import "../icons/pf-icon";
import type { IconName } from "../icons/icon-paths";

@customElement("pf-icon-button")
export class PfIconButton extends LitElement {
  static styles = css`
    :host {
      display: inline-flex;
    }
    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2rem;
      height: 2rem;
      padding: 0;
      border-radius: var(--pf-radius-md);
      border: 1px solid transparent;
      background: transparent;
      color: var(--pf-text-muted);
      cursor: pointer;
      transition: background var(--pf-transition), color var(--pf-transition),
        border-color var(--pf-transition);
    }
    button:hover {
      background: var(--pf-surface-hover);
      color: var(--pf-accent-hover);
    }
    button:focus-visible {
      outline: 2px solid var(--pf-accent);
      outline-offset: 2px;
    }
    pf-icon {
      font-size: 1.05rem;
    }
  `;

  @property({ type: String })
  icon: IconName = "folder";

  @property({ type: String })
  label = "";

  render() {
    return html`<button type="button" aria-label=${this.label} title=${this.label}>
      <pf-icon name=${this.icon}></pf-icon>
    </button>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-icon-button": PfIconButton;
  }
}

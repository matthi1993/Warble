import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("pf-button")
export class PfButton extends LitElement {
  static styles = css`
    :host {
      display: inline-flex;
    }
    button {
      display: inline-flex;
      align-items: center;
      gap: var(--pf-space-2);
      font: inherit;
      font-size: var(--pf-text-sm);
      font-weight: 500;
      line-height: 1;
      padding: var(--pf-space-2) var(--pf-space-3);
      border-radius: var(--pf-radius-md);
      border: 1px solid var(--pf-border);
      background: var(--pf-surface);
      color: var(--pf-text);
      cursor: pointer;
      transition: background var(--pf-transition), border-color var(--pf-transition),
        color var(--pf-transition);
    }
    button:hover {
      background: var(--pf-surface-hover);
      border-color: var(--pf-accent);
      color: var(--pf-accent-hover);
    }
    button:focus-visible {
      outline: 2px solid var(--pf-accent);
      outline-offset: 2px;
    }
    :host([variant="primary"]) button {
      background: var(--pf-accent);
      border-color: var(--pf-accent);
      color: var(--pf-on-accent);
    }
    :host([variant="primary"]) button:hover {
      background: var(--pf-accent-hover);
      border-color: var(--pf-accent-hover);
      color: var(--pf-on-accent);
    }
  `;

  @property({ type: String, reflect: true })
  variant: "default" | "primary" = "default";

  render() {
    return html`<button><slot></slot></button>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-button": PfButton;
  }
}

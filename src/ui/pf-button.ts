import { LitElement, css, html } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("pf-button")
export class PfButton extends LitElement {
  static styles = css`
    button {
      font: inherit;
      padding: 0.5rem 1rem;
      border: 1px solid #888;
      border-radius: 0.375rem;
      background: #f5f5f5;
      cursor: pointer;
    }
    button:hover {
      background: #e5e5e5;
    }
  `;

  render() {
    return html`<button><slot></slot></button>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-button": PfButton;
  }
}

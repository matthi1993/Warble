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
    :host([danger]) button {
      color: var(--pf-danger, #d14a4a);
      background: color-mix(in srgb, var(--pf-danger, #d14a4a) 10%, transparent);
      border-color: color-mix(in srgb, var(--pf-danger, #d14a4a) 32%, transparent);
    }
    :host([danger]) button:hover {
      color: var(--pf-danger, #e05252);
      background: color-mix(in srgb, var(--pf-danger, #d14a4a) 18%, transparent);
      border-color: var(--pf-danger, #d14a4a);
    }
    button:disabled {
      opacity: 0.4;
      cursor: default;
    }
    button:disabled:hover {
      background: transparent;
      color: var(--pf-text-muted);
    }
    button:focus-visible {
      outline: 2px solid var(--pf-accent);
      outline-offset: 2px;
    }
    pf-icon {
      font-size: 1.05rem;
    }
    .spinner {
      width: 0.9rem;
      height: 0.9rem;
      box-sizing: border-box;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }
    :host([loading]) button:disabled {
      opacity: 1;
      cursor: progress;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      .spinner { animation-duration: 1.4s; }
    }
    @media (pointer: coarse) {
      button {
        width: 44px;
        height: 44px;
      }
    }
  `;

  @property({ type: String })
  icon: IconName = "folder";

  @property({ type: String })
  label = "";

  @property({ type: Boolean })
  disabled = false;

  @property({ type: Boolean, reflect: true })
  danger = false;

  @property({ type: Boolean, reflect: true })
  loading = false;

  render() {
    return html`<button
      type="button"
      aria-label=${this.label}
      aria-busy=${this.loading ? "true" : "false"}
      title=${this.label}
      ?disabled=${this.disabled}
    >
      ${this.loading
        ? html`<span class="spinner" aria-hidden="true"></span>`
        : html`<pf-icon name=${this.icon}></pf-icon>`}
    </button>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-icon-button": PfIconButton;
  }
}

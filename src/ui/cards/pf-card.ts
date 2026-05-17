/**
 * `pf-card` — a generic disclosure-style edit card with a header
 * (chevron + title), an optional revert button slot, and a body that
 * shows/hides based on `open`.
 *
 * Used by the full-view edit side panel for Info / Crop / Basic
 * cards. The visual styling matches the legacy `.edit-card` rules in
 * `full-view.ts` so the in-place migration produces no UI change.
 */
import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import "../icons/pf-icon";

@customElement("pf-card")
export class PfCard extends LitElement {
  static styles = css`
    :host {
      display: block;
      border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-md);
      background: var(--pf-surface-2);
      overflow: hidden;
    }
    .header-row {
      display: flex;
      align-items: stretch;
      width: 100%;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: 1 1 auto;
      min-width: 0;
      background: transparent;
      color: var(--pf-text);
      border: none;
      padding: 8px 10px;
      font-size: var(--pf-text-sm);
      font-weight: 600;
      letter-spacing: 0.02em;
      cursor: pointer;
      text-align: left;
    }
    .header:hover {
      background: var(--pf-surface-hover);
    }
    .header pf-icon {
      font-size: 0.9rem;
      transition: transform 150ms ease;
    }
    :host(:not([open])) .header pf-icon.chevron {
      transform: rotate(-90deg);
    }
    .body {
      padding: 6px 10px 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    :host(:not([open])) .body {
      display: none;
    }
    ::slotted([slot="revert"]) {
      flex: 0 0 auto;
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
    ::slotted([slot="revert"]:hover) {
      background: var(--pf-surface-hover);
      color: var(--pf-text);
    }
    ::slotted([slot="revert"]:disabled) {
      opacity: 0.35;
      cursor: default;
    }
  `;

  @property({ type: String })
  title = "";

  @property({ type: Boolean, reflect: true })
  open = false;

  private toggle = () => {
    this.dispatchEvent(
      new CustomEvent("toggle", {
        detail: { open: !this.open },
        bubbles: true,
        composed: true,
      })
    );
  };

  render() {
    return html`
      <div class="header-row">
        <button
          type="button"
          class="header"
          aria-expanded=${this.open}
          @click=${this.toggle}
        >
          <pf-icon class="chevron" name="chevron-down"></pf-icon>
          <span>${this.title}</span>
        </button>
        <slot name="revert"></slot>
      </div>
      <div class="body">
        <slot></slot>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-card": PfCard;
  }
}

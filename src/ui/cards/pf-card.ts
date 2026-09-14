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
    .before-after {
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
      touch-action: none;
    }
    .before-after:hover,
    .before-after[aria-pressed="true"] {
      background: var(--pf-surface-hover);
      color: var(--pf-text);
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

  @property({ type: Boolean, attribute: "before-after" })
  beforeAfter = false;

  private previewing = false;

  private startPreview = (event: PointerEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    this.previewing = true;
    this.requestUpdate();
    if (event.currentTarget instanceof Element) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is optional on older embedded WebViews.
      }
    }
    window.addEventListener("pointerup", this.endPreview, { once: true });
    window.addEventListener("pointercancel", this.endPreview, { once: true });
    window.addEventListener("blur", this.endPreview, { once: true });
    this.dispatchEvent(new CustomEvent("tool-preview-start", {
      bubbles: true,
      composed: true,
    }));
  };

  private endPreview = (event: Event): void => {
    if (event.currentTarget !== window) event.stopPropagation();
    window.removeEventListener("pointerup", this.endPreview);
    window.removeEventListener("pointercancel", this.endPreview);
    window.removeEventListener("blur", this.endPreview);
    if (!this.previewing) return;
    this.previewing = false;
    this.requestUpdate();
    this.dispatchEvent(new CustomEvent("tool-preview-end", {
      bubbles: true,
      composed: true,
    }));
  };

  disconnectedCallback(): void {
    if (this.previewing) this.endPreview(new Event("disconnect"));
    super.disconnectedCallback();
  }

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
        ${this.beforeAfter ? html`
          <button
            type="button"
            class="before-after"
            title="Hold to show before"
            aria-label="Hold to show before"
            aria-pressed=${this.previewing}
            @pointerdown=${this.startPreview}
            @pointerup=${this.endPreview}
            @pointercancel=${this.endPreview}
            @lostpointercapture=${this.endPreview}
            @contextmenu=${(event: Event) => event.preventDefault()}
          ><pf-icon name="compare"></pf-icon></button>
        ` : null}
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

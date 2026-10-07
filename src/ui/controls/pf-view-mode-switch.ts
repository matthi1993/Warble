import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import "../icons/pf-icon";

@customElement("pf-view-mode-switch")
export class PfViewModeSwitch extends LitElement {
  static styles = css`
    :host { display: inline-flex; flex: 0 0 auto; }
    .modes { display: flex; gap: 4px; }
    button {
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      border: 1px solid transparent;
      border-radius: var(--pf-radius-md);
      background: transparent;
      color: var(--pf-text-muted);
      cursor: pointer;
    }
    button[aria-pressed="true"] { background: var(--pf-accent-soft); color: var(--pf-accent-hover); }
    button:hover:not(:disabled) { border-color: var(--pf-accent); }
    button:disabled { opacity: .4; cursor: default; }
    button:focus-visible { outline: 2px solid var(--pf-accent); outline-offset: -2px; }
    pf-icon { width: 20px; height: 20px; }
  `;

  @property() mode: "grid" | "image" = "grid";
  @property({ type: Boolean }) imageDisabled = false;

  render() {
    return html`<div class="modes" role="group" aria-label="View mode">
      ${(["grid", "image"] as const).map((mode) => html`<button type="button"
        aria-label=${mode === "grid" ? "Grid view" : "Full image view"}
        title=${mode === "grid" ? "Grid view (G)" : "Full image view (G)"}
        aria-pressed=${this.mode === mode}
        ?disabled=${mode === "image" && this.imageDisabled}
        @click=${() => {
          if (this.mode !== mode) this.dispatchEvent(new CustomEvent("view-mode-change", {
            detail: { mode }, bubbles: true, composed: true,
          }));
        }}><pf-icon name=${mode}></pf-icon></button>`)}
    </div>`;
  }
}

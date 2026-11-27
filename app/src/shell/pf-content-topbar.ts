import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import "@ui/icons/pf-icon";
import { contentTopbarStyles } from "./pf-content-topbar.styles";

@customElement("pf-content-topbar")
export class PfContentTopbar extends LitElement {
  static styles = contentTopbarStyles;

  @property({ attribute: false }) breadcrumb: string | null = null;
  @property({ type: Boolean }) showDetailToggle = false;
  @property({ type: Boolean }) detailOpen = false;

  private emit(name: string): void {
    this.dispatchEvent(new CustomEvent(name));
  }

  render() {
    return html`
      <nav class="content-topbar" aria-label="Current folder">
        <button class="mobile-menu-button" type="button" aria-label="Open folders"
          @click=${() => this.emit("sidebar-toggle")}>
          <pf-icon name="panel-left-open"></pf-icon>
        </button>
        <pf-icon name="folder"></pf-icon>
        <span>Library</span>
        ${this.breadcrumb
          ? html`<span class="breadcrumb-separator">›</span><span class="breadcrumb-current">${this.breadcrumb}</span>`
          : null}
        <span class="topbar-spacer"></span>
        ${this.showDetailToggle
          ? html`<button class="detail-toggle" type="button" aria-label="Photo details" aria-expanded=${this.detailOpen}
              @click=${() => this.emit("detail-toggle")}><pf-icon name="info"></pf-icon> Info</button>`
          : null}
      </nav>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-content-topbar": PfContentTopbar;
  }
}

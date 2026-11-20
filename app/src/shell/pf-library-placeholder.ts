import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { APP_ICON_URL } from "./app-icon";
import type { ContentKind } from "./library-view-model";
import { libraryPlaceholderStyles } from "./pf-library-placeholder.styles";

@customElement("pf-library-placeholder")
export class PfLibraryPlaceholder extends LitElement {
  static styles = libraryPlaceholderStyles;

  @property({ type: String }) kind: Exclude<ContentKind, "grid"> = "welcome";
  @property({ type: String }) heading = "";
  @property({ type: String }) message = "";
  @property({ type: Boolean }) showSubfolderToggle = false;
  @property({ type: Boolean }) includeSubfolders = false;

  private toggleIncludeSubfolders(): void {
    this.dispatchEvent(new CustomEvent("toggle-include-subfolders", { bubbles: true, composed: true }));
  }

  private renderWelcome() {
    return html`<div class="welcome">
      <div class="welcome-inner">
        <img src=${APP_ICON_URL} alt="Warble" />
        <h1>Warble</h1>
        <p>Add a folder to get started.</p>
      </div>
    </div>`;
  }

  private renderAlbumsWelcome() {
    return html`<div class="welcome">
      <div class="welcome-inner">
        <h1>Albums</h1>
        <p>Select an album or create one to get started.</p>
      </div>
    </div>`;
  }

  private renderEmpty() {
    return html`
      <div class="empty-content-header">
        <h1>${this.heading}</h1>
        ${this.showSubfolderToggle
          ? html`<label class="include-subfolders-toggle" title="Show photos from all nested subfolders of the selected folder">
              <input type="checkbox" .checked=${this.includeSubfolders} @change=${this.toggleIncludeSubfolders} />
              Include subfolders
            </label>`
          : null}
      </div>
      <p>${this.message}</p>
    `;
  }

  render() {
    if (this.kind === "welcome") return this.renderWelcome();
    return this.kind === "albumsWelcome" ? this.renderAlbumsWelcome() : this.renderEmpty();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-library-placeholder": PfLibraryPlaceholder;
  }
}

import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { Folder } from "@domain/folder";
import { sidebarSectionStyles } from "./sidebar-section-styles";
import "@ui/folders/pf-folder-tree-item";

@customElement("pf-sidebar-folders")
export class SidebarFolders extends LitElement {
  static styles = [sidebarSectionStyles];

  @property({ attribute: false }) folders: Folder[] = [];
  @property({ attribute: false }) photoCounts: Readonly<Record<string, number>> = {};
  @property({ type: String }) selectedId: string | null = null;

  private onBackgroundClick(event: MouseEvent): void {
    if (event.composedPath().some((node) => node instanceof HTMLElement && node.tagName === "PF-FOLDER-TREE-ITEM")) return;
    if (event.composedPath().some((node) => node instanceof HTMLElement && node.classList.contains("add-button"))) return;
    this.dispatchEvent(new CustomEvent("folder-clear", { bubbles: true, composed: true }));
  }

  render() {
    return html`
      <div @click=${this.onBackgroundClick}>
        ${this.folders.length
          ? this.folders.map((folder) => html`
              <pf-folder-tree-item .folder=${folder} .photoCounts=${this.photoCounts}
                is-root selected-id=${this.selectedId ?? ""}></pf-folder-tree-item>
            `)
          : html`<div class="empty">No folders imported yet.</div>`}
        <div class="section-actions">
          <button type="button" class="add-button" @click=${() => this.dispatchEvent(new CustomEvent("add-folders", { bubbles: true, composed: true }))}>
            <pf-icon name="folder-plus"></pf-icon>
            Add folders
          </button>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-sidebar-folders": SidebarFolders;
  }
}

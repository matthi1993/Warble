import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Folder } from "../app/types";

@customElement("pf-folder-tree-item")
export class PfFolderTreeItem extends LitElement {
  static styles = css`
    :host {
      display: block;
      font-size: 0.9rem;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.2rem 0.25rem;
      border-radius: 0.25rem;
      cursor: pointer;
      user-select: none;
    }
    .row:hover {
      background: #ececec;
    }
    .row.selected {
      background: #d8e6ff;
    }
    .row.root .name {
      font-weight: 600;
      font-size: 0.8rem;
      color: #444;
    }
    .chevron {
      width: 1rem;
      display: inline-flex;
      justify-content: center;
      font-size: 0.7rem;
      color: #666;
    }
    .chevron.placeholder {
      visibility: hidden;
    }
    .name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .children {
      padding-left: 1rem;
      border-left: 1px dashed #ddd;
      margin-left: 0.55rem;
    }
  `;

  @property({ attribute: false })
  folder!: Folder;

  @property({ type: String, attribute: "selected-id" })
  selectedId: string | null = null;

  @property({ type: Boolean, attribute: "is-root" })
  isRoot = false;

  @state()
  private expanded = false;

  connectedCallback(): void {
    super.connectedCallback();
    if (this.isRoot) {
      this.expanded = true;
    }
  }

  private toggle(e: Event) {
    e.stopPropagation();
    this.expanded = !this.expanded;
  }

  private select() {
    this.dispatchEvent(
      new CustomEvent<{ id: string; path: string }>("folder-select", {
        detail: { id: this.folder.id, path: this.folder.path },
        bubbles: true,
        composed: true,
      })
    );
  }

  render() {
    const hasChildren = this.folder.children.length > 0;
    const isSelected = this.selectedId === this.folder.id;
    const label = this.isRoot ? this.folder.path : this.folder.name;
    return html`
      <div class="row ${isSelected ? "selected" : ""} ${this.isRoot ? "root" : ""}" @click=${this.select}>
        ${hasChildren
          ? html`<span class="chevron" @click=${this.toggle}
              >${this.expanded ? "▼" : "▶"}</span
            >`
          : html`<span class="chevron placeholder">•</span>`}
        <span class="name" title=${this.folder.path}>${label}</span>
      </div>
      ${this.expanded && hasChildren
        ? html`<div class="children">
            ${this.folder.children.map(
              (child) => html`
                <pf-folder-tree-item
                  .folder=${child}
                  selected-id=${this.selectedId ?? ""}
                ></pf-folder-tree-item>
              `
            )}
          </div>`
        : null}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-folder-tree-item": PfFolderTreeItem;
  }
}

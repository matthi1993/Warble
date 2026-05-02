import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Folder } from "../../app/types";
import "../icons/pf-icon";

@customElement("pf-folder-tree-item")
export class PfFolderTreeItem extends LitElement {
  static styles = css`
    :host {
      display: block;
      font-size: var(--pf-text-sm);
      color: var(--pf-text);
    }
    .row {
      display: flex;
      align-items: center;
      gap: var(--pf-space-2);
      padding: var(--pf-space-1) var(--pf-space-2);
      border-radius: var(--pf-radius-sm);
      cursor: pointer;
      user-select: none;
      transition: background var(--pf-transition), color var(--pf-transition);
    }
    .row:hover {
      background: var(--pf-surface-hover);
    }
    .row.selected {
      background: var(--pf-accent-soft);
      color: var(--pf-accent-hover);
    }
    .row.root .name {
      font-weight: 600;
      font-size: var(--pf-text-xs);
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--pf-text-muted);
    }
    .chevron {
      width: 1rem;
      display: inline-flex;
      justify-content: center;
      align-items: center;
      font-size: 0.85rem;
      color: var(--pf-text-subtle);
    }
    .chevron.placeholder {
      visibility: hidden;
    }
    .folder-icon {
      font-size: 0.95rem;
      color: var(--pf-text-muted);
    }
    .row.selected .folder-icon {
      color: var(--pf-accent);
    }
    .name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .children {
      padding-left: var(--pf-space-3);
      border-left: 1px dashed var(--pf-border);
      margin-left: 0.7rem;
      margin-top: 2px;
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
    const label = this.folder.name;
    return html`
      <div
        class="row ${isSelected ? "selected" : ""} ${this.isRoot ? "root" : ""}"
        @click=${this.select}
      >
        ${hasChildren
          ? html`<span class="chevron" @click=${this.toggle}>
              <pf-icon name=${this.expanded ? "chevron-down" : "chevron-right"}></pf-icon>
            </span>`
          : html`<span class="chevron placeholder">·</span>`}
        <pf-icon class="folder-icon" name="folder"></pf-icon>
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

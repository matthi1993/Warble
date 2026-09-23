import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Folder } from "@domain/folder";
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
      min-height: 30px;
      padding: var(--pf-space-1) var(--pf-space-2);
      border-radius: var(--pf-radius-md);
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
      box-shadow: inset 2px 0 var(--pf-accent);
    }
    .row.root .name {
      font-weight: 600;
      color: var(--pf-text);
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
    .row.unavailable {
      color: var(--pf-text-subtle);
    }
    .row.unavailable .folder-icon {
      color: var(--pf-danger);
    }
    .status {
      font-size: var(--pf-text-xs);
      color: var(--pf-danger);
    }
    .spinner {
      width: 0.75rem;
      height: 0.75rem;
      border: 2px solid var(--pf-border);
      border-top-color: var(--pf-accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      flex: 0 0 auto;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      .spinner { animation-duration: 1.6s; }
    }
    .name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .count {
      flex: 0 0 auto;
      color: var(--pf-text-muted);
      font-size: var(--pf-text-xs);
      font-variant-numeric: tabular-nums;
    }
    .children {
      padding-left: var(--pf-space-3);
      margin-top: 2px;
    }
  `;

  @property({ attribute: false })
  folder!: Folder;

  @property({ type: String, attribute: "selected-id" })
  selectedId: string | null = null;

  @property({ type: Boolean, attribute: "is-root" })
  isRoot = false;

  @property({ attribute: false })
  photoCounts: Readonly<Record<string, number>> = {};

  @state()
  private expanded = false;

  private longPressTimer: number | null = null;
  private longPressStart: { x: number; y: number } | null = null;
  private suppressNextClick = false;

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
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return;
    }
    if (!this.folder.available) {
      this.dispatchEvent(
        new CustomEvent<{ rootId: string }>("root-reconnect", {
          detail: { rootId: this.folder.id },
          bubbles: true,
          composed: true,
        })
      );
      return;
    }
    this.dispatchEvent(
      new CustomEvent<{ id: string; path: string }>("folder-select", {
        detail: { id: this.folder.id, path: this.folder.path },
        bubbles: true,
        composed: true,
      })
    );
  }

  private openFolderMenu(clientX: number, clientY: number) {
    this.dispatchEvent(
      new CustomEvent("folder-context-menu", {
        detail: {
          folderId: this.folder.id,
          path: this.folder.path,
          name: this.folder.name,
          isRoot: this.isRoot,
          available: this.folder.available,
          x: clientX,
          y: clientY,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    this.openFolderMenu(event.clientX, event.clientY);
  };

  private onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "mouse") return;
    this.cancelLongPress();
    this.longPressStart = { x: event.clientX, y: event.clientY };
    this.longPressTimer = window.setTimeout(() => {
      this.longPressTimer = null;
      this.suppressNextClick = true;
      this.openFolderMenu(event.clientX, event.clientY);
    }, 550);
  };

  private onPointerMove = (event: PointerEvent) => {
    const start = this.longPressStart;
    if (!start) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) {
      this.cancelLongPress();
    }
  };

  private cancelLongPress = () => {
    if (this.longPressTimer !== null) window.clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
    this.longPressStart = null;
  };

  render() {
    const hasChildren = this.folder.children.length > 0;
    const isSelected = this.selectedId === this.folder.id;
    const label = this.folder.name;
    return html`
      <div
        class="row ${isSelected ? "selected" : ""} ${this.isRoot ? "root" : ""} ${this.folder.available ? "" : "unavailable"}"
        @click=${this.select}
        @contextmenu=${this.onContextMenu}
        @pointerdown=${this.onPointerDown}
        @pointermove=${this.onPointerMove}
        @pointerup=${this.cancelLongPress}
        @pointercancel=${this.cancelLongPress}
        @pointerleave=${this.cancelLongPress}
      >
        ${hasChildren
          ? html`<span class="chevron" @click=${this.toggle}>
              <pf-icon name=${this.expanded ? "chevron-down" : "chevron-right"}></pf-icon>
            </span>`
          : html`<span class="chevron placeholder">·</span>`}
        <pf-icon class="folder-icon" name="folder"></pf-icon>
        <span class="name" title=${this.folder.path}>${label}</span>
        ${this.folder.available
          ? html`<span class="count" title="Photos including subfolders">${this.photoCounts[this.folder.id]?.toLocaleString() ?? "…"}</span>`
          : null}
        ${this.folder.scanning
          ? html`<span class="spinner" title="Scanning folder" aria-label="Scanning folder"></span>`
          : null}
        ${this.folder.available ? null : html`<span class="status">Reconnect</span>`}
      </div>
      ${this.expanded && hasChildren
        ? html`<div class="children">
            ${this.folder.children.map(
              (child) => html`
                <pf-folder-tree-item
                  .folder=${child}
                  .photoCounts=${this.photoCounts}
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

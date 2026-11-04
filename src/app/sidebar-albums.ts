import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { sidebarSectionStyles } from "./sidebar-section-styles";
import "@ui/icons/pf-icon";

export interface Album {
  id: string;
  name: string;
  description: string;
  photoCount: number;
}

@customElement("pf-sidebar-albums")
export class SidebarAlbums extends LitElement {
  static styles = [sidebarSectionStyles, css`
    .album-row {
      display: flex;
      align-items: center;
      gap: var(--pf-space-2);
      width: 100%;
      min-height: 34px;
      padding: var(--pf-space-2);
      box-sizing: border-box;
      border: 0;
      border-radius: var(--pf-radius-md);
      background: transparent;
      color: var(--pf-text);
      font: inherit;
      font-size: var(--pf-text-sm);
      text-align: left;
      cursor: pointer;
    }
    .album-row:hover, .album-row.drag-over { background: var(--pf-surface-hover); }
    .album-row.selected {
      background: var(--pf-accent-soft);
      color: var(--pf-accent-hover);
      box-shadow: inset 2px 0 var(--pf-accent);
    }
    .album-row.drag-over {
      background: rgba(35, 165, 85, .22);
      box-shadow: inset 0 0 0 2px #23a555;
    }
    .album-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .album-count { color: var(--pf-text-muted); font-size: var(--pf-text-xs); }
  `];

  @property({ attribute: false }) albums: Album[] = [];
  @property({ type: String }) selectedId: string | null = null;
  @property({ type: Boolean }) active = false;
  @state() private dragOverId: string | null = null;

  albumAt(x: number, y: number): string | null {
    const host = this.getBoundingClientRect();
    if (x < host.left || x > host.right || y < host.top || y > host.bottom) return null;
    for (const row of this.renderRoot.querySelectorAll<HTMLElement>(".album-row")) {
      const rect = row.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return row.dataset.albumId ?? null;
      }
    }
    return null;
  }

  highlightAlbum(id: string | null): void {
    if (this.dragOverId !== id) this.dragOverId = id;
  }

  render() {
    return html`
      ${this.albums.length ? this.albums.map((album) => html`
        <button type="button" class=${`album-row ${this.active && this.selectedId === album.id ? "selected" : ""} ${this.dragOverId === album.id ? "drag-over" : ""}`}
          data-album-id=${album.id}
          title=${album.description || album.name}
          aria-current=${this.active && this.selectedId === album.id ? "page" : "false"}
          @click=${() => this.dispatchEvent(new CustomEvent("album-select", { detail: { id: album.id }, bubbles: true, composed: true }))}
          @contextmenu=${(event: MouseEvent) => {
            event.preventDefault();
            this.dispatchEvent(new CustomEvent("album-context-menu", {
              detail: { id: album.id, x: event.clientX, y: event.clientY }, bubbles: true, composed: true,
            }));
          }}>
          <pf-icon name="image"></pf-icon>
          <span class="album-name">${album.name}</span>
          <span class="album-count">${album.photoCount}</span>
        </button>`)
        : html`<div class="empty">No albums yet.</div>`}
      <div class="section-actions">
        <button type="button" class="add-button" @click=${() => this.dispatchEvent(new CustomEvent("album-create", { bubbles: true, composed: true }))}>
          <pf-icon name="folder-plus"></pf-icon>
          Add album
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-sidebar-albums": SidebarAlbums;
  }
}

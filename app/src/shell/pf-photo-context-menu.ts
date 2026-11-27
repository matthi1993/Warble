import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Album } from "@warble/library";
import { contextMenuStyles } from "./context-menu.styles";
import { MenuPlacement } from "./menu-placement";
import type { PhotoMenu } from "./shell-fields";

@customElement("pf-photo-context-menu")
export class PfPhotoContextMenu extends LitElement {
  static styles = contextMenuStyles;

  @property({ attribute: false }) menu!: PhotoMenu;
  @property({ attribute: false }) albums: Album[] = [];
  @property({ type: String }) revealLabel = "";
  @state() private albumPickerOpen = false;

  protected willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("menu")) this.albumPickerOpen = false;
  }

  private emit(name: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  private get placement(): MenuPlacement {
    const height = this.albumPickerOpen ? Math.min(400, 195 + this.albums.length * 38) : 112;
    return new MenuPlacement(240, height);
  }

  private renderAlbumPicker() {
    return html`<div class="album-menu-list" role="group" aria-label="Choose an album">
      ${this.albums.length
        ? this.albums.map((album) => html`
            <button role="menuitem"
              @click=${() => this.emit("album-add", { albumId: album.id, paths: this.menu.paths })}>${album.name}</button>
          `)
        : html`<div class="album-menu-empty">Create an album in the sidebar first.</div>`}
    </div>`;
  }

  render() {
    const menu = this.menu;
    return html`
      <div class="ctx-menu-backdrop" @click=${() => this.emit("menu-close")}
        @contextmenu=${(event: MouseEvent) => {
          event.preventDefault();
          this.emit("menu-close");
        }}></div>
      <div class="ctx-menu" role="menu" style=${this.placement.style(menu)}>
        <button role="menuitem" aria-expanded=${this.albumPickerOpen}
          @click=${() => (this.albumPickerOpen = !this.albumPickerOpen)}>
          Add ${menu.paths.length > 1 ? `${menu.paths.length} photos` : "photo"} to album…
        </button>
        ${this.albumPickerOpen ? this.renderAlbumPicker() : null}
        <button role="menuitem" @click=${() => this.emit("metadata-edit")}>Edit metadata…</button>
        <button role="menuitem" @click=${() => this.emit("photo-reveal", { path: menu.path })}>
          ${this.revealLabel}
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-photo-context-menu": PfPhotoContextMenu;
  }
}

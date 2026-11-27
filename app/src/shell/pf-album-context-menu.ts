import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { Album } from "@warble/library";
import { contextMenuStyles } from "./context-menu.styles";
import { MenuPlacement } from "./menu-placement";
import type { AlbumMenu } from "./shell-fields";

@customElement("pf-album-context-menu")
export class PfAlbumContextMenu extends LitElement {
  static styles = contextMenuStyles;

  @property({ attribute: false }) menu!: AlbumMenu;
  @property({ attribute: false }) album!: Album;

  private emit(name: string): void {
    this.dispatchEvent(new CustomEvent(name, { detail: { album: this.album } }));
  }

  render() {
    return html`
      <div class="ctx-menu-backdrop" @click=${() => this.emit("menu-close")}
        @contextmenu=${(event: MouseEvent) => {
          event.preventDefault();
          this.emit("menu-close");
        }}></div>
      <div class="ctx-menu" role="menu" aria-label=${`Actions for ${this.album.name}`}
        style=${new MenuPlacement(230, 100).style(this.menu)}>
        <button role="menuitem" @click=${() => this.emit("album-edit")}>Edit album…</button>
        <button class="danger" role="menuitem" @click=${() => this.emit("album-delete")}>Delete album</button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-album-context-menu": PfAlbumContextMenu;
  }
}

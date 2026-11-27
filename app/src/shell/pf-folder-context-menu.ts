import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { contextMenuStyles } from "./context-menu.styles";
import { MenuPlacement } from "./menu-placement";
import type { FolderMenu } from "./shell-fields";

@customElement("pf-folder-context-menu")
export class PfFolderContextMenu extends LitElement {
  static styles = contextMenuStyles;

  @property({ attribute: false }) menu!: FolderMenu;

  private emit(name: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  render() {
    const menu = this.menu;
    const rootId = menu.folderId.split("/")[0];
    return html`
      <div class="ctx-menu-backdrop" @click=${() => this.emit("menu-close")}
        @contextmenu=${(event: MouseEvent) => {
          event.preventDefault();
          this.emit("menu-close");
        }}></div>
      <div class="ctx-menu" role="menu" aria-label=${`Actions for ${menu.name}`}
        style=${new MenuPlacement(230, menu.isRoot ? 164 : 110).style(menu)}>
        <button role="menuitem"
          @click=${() => this.emit("folder-sync", { path: menu.path, name: menu.name })}>Sync Folder</button>
        ${menu.available ? null : html`<button role="menuitem"
          @click=${() => this.emit("folder-reconnect", { rootId })}>Reconnect Folder…</button>`}
        ${menu.isRoot ? html`<button class="danger" role="menuitem"
          @click=${() => this.emit("folder-remove", { rootId: menu.folderId })}>Remove from Library</button>` : null}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-folder-context-menu": PfFolderContextMenu;
  }
}

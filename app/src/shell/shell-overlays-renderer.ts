import { html, type TemplateResult } from "lit";
import type { Shell } from "./shell";

export class ShellOverlaysRenderer {
  constructor(private readonly shell: Shell) {}

  render(): TemplateResult {
    return html`
      ${this.renderPhotoMenu()} ${this.renderFolderMenu()} ${this.renderAlbumMenu()} ${this.renderAlbumDialog()}
      ${this.renderDragPreview()} ${this.renderMetadataEditor()}
    `;
  }

  private renderPhotoMenu(): TemplateResult | null {
    const { state, menus, albums, environment } = this.shell;
    if (!state.photoMenu) return null;
    return html`<pf-photo-context-menu
      .menu=${state.photoMenu}
      .albums=${state.albums}
      .revealLabel=${environment.revealLabel}
      @menu-close=${() => menus.closePhotoMenu()}
      @album-add=${(event: CustomEvent<{ albumId: string; paths: string[] }>) => {
        menus.closePhotoMenu();
        void albums.addPhotos(event.detail.albumId, event.detail.paths);
      }}
      @metadata-edit=${() => menus.editMetadata()}
      @photo-reveal=${(event: CustomEvent<{ path: string }>) => menus.revealInFileManager(event.detail.path)}
    ></pf-photo-context-menu>`;
  }

  private renderFolderMenu(): TemplateResult | null {
    const { state, menus, folders } = this.shell;
    if (!state.folderMenu) return null;
    return html`<pf-folder-context-menu
      .menu=${state.folderMenu}
      @menu-close=${() => menus.closeFolderMenu()}
      @folder-sync=${(event: CustomEvent<{ path: string; name: string }>) =>
        folders.sync(event.detail.path, event.detail.name)}
      @folder-reconnect=${(event: CustomEvent<{ rootId: string }>) => {
        menus.closeFolderMenu();
        void folders.reconnect(event.detail.rootId);
      }}
      @folder-remove=${(event: CustomEvent<{ rootId: string }>) => folders.remove(event.detail.rootId)}
    ></pf-folder-context-menu>`;
  }

  private renderAlbumMenu(): TemplateResult | null {
    const { state, menus, albums, viewModel } = this.shell;
    const album = viewModel.menuAlbum;
    if (!state.albumMenu || !album) return null;
    return html`<pf-album-context-menu
      .menu=${state.albumMenu}
      .album=${album}
      @menu-close=${() => menus.closeAlbumMenu()}
      @album-edit=${() => albums.openDialog(album)}
      @album-delete=${() => void albums.delete(album.id)}
    ></pf-album-context-menu>`;
  }

  private renderAlbumDialog(): TemplateResult | null {
    const { state, albums } = this.shell;
    if (!state.albumDialog) return null;
    return html`<pf-album-dialog
      .album=${state.albumDialog}
      .error=${state.albumError}
      @dialog-close=${() => albums.closeDialog()}
      @album-save=${(event: CustomEvent<{ name: string; description: string }>) =>
        albums.save(event.detail.name, event.detail.description)}
    ></pf-album-dialog>`;
  }

  private renderDragPreview(): TemplateResult | null {
    const label = this.shell.state.photoDragLabel;
    return label ? html`<div class="photo-drag-preview">${label}</div>` : null;
  }

  private renderMetadataEditor(): TemplateResult | null {
    const { state, menus, photoChanges } = this.shell;
    if (!state.metadataPaths.length) return null;
    return html`<pf-metadata-editor
      .paths=${state.metadataPaths}
      @close=${() => menus.closeMetadataEditor()}
      @metadata-saved=${(event: CustomEvent<{ paths: string[]; dateTaken?: string | null }>) =>
        photoChanges.metadataSaved(event.detail)}
    ></pf-metadata-editor>`;
  }
}

import type { PhotoBackend } from "@warble/library";
import type { AlbumMenu, FolderMenu, PhotoMenu } from "./shell-fields";
import type { ShellState } from "./shell-state";
import type { ShellViews } from "./shell-views";

export class ContextMenusController {
  constructor(
    private readonly state: ShellState,
    private readonly backend: Pick<PhotoBackend, "revealInFileManager">,
    private readonly views: Pick<ShellViews, "grid">,
  ) {}

  /** A right-click inside the grid selection acts on the whole selection. */
  openPhotoMenu(target: Omit<PhotoMenu, "paths">): void {
    const selection = this.views.grid()?.getSelectionPaths() ?? [];
    const paths = selection.includes(target.path) ? selection : [target.path];
    this.state.change({ photoMenu: { ...target, paths } });
  }

  closePhotoMenu(): void {
    this.state.change({ photoMenu: null });
  }

  editMetadata(): void {
    const menu = this.state.photoMenu;
    if (menu) this.state.change({ metadataPaths: menu.paths, photoMenu: null });
  }

  closeMetadataEditor(): void {
    this.state.change({ metadataPaths: [] });
  }

  async revealInFileManager(path: string): Promise<void> {
    this.state.change({ photoMenu: null });
    try {
      await this.backend.revealInFileManager(path);
    } catch (error) {
      console.error("reveal_in_file_manager failed", error);
    }
  }

  openFolderMenu(menu: FolderMenu): void {
    this.state.change({ photoMenu: null, folderMenu: { ...menu } });
  }

  closeFolderMenu(): void {
    this.state.change({ folderMenu: null });
  }

  openAlbumMenu(menu: AlbumMenu): void {
    this.state.change({ albumMenu: menu });
  }

  closeAlbumMenu(): void {
    this.state.change({ albumMenu: null });
  }
}

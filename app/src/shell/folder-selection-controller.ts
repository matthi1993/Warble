import {
  buildFolderForest,
  findFolderByPath,
  type FolderBackend,
  type PhotoBackend,
  type WorkspaceBackend,
} from "@warble/library";
import type { PhotoListController } from "./photo-list-controller";
import type { ShellState } from "./shell-state";
import type { SidebarSectionsController } from "./sidebar-sections-controller";

export type FolderSelectionBackend = Pick<PhotoBackend, "getPhotosInFolder"> &
  Pick<FolderBackend, "indexFolderImages"> &
  Pick<WorkspaceBackend, "getLastFolder" | "setLastFolder">;

export class FolderSelectionController {
  constructor(
    private readonly state: ShellState,
    private readonly backend: FolderSelectionBackend,
    private readonly photoList: PhotoListController,
    private readonly sections: SidebarSectionsController,
  ) {}

  async restoreLast(): Promise<void> {
    try {
      const lastPath = await this.backend.getLastFolder();
      if (!lastPath) return;
      const folder = findFolderByPath(buildFolderForest(this.state.imports), lastPath);
      if (folder) await this.select(folder.id, folder.path);
      else this.state.change({ pendingRestoreFolderPath: lastPath });
    } catch (error) {
      console.error("Failed to restore last folder", error);
    }
  }

  async selectFromSidebar(id: string, path: string): Promise<void> {
    this.state.change({ mobileSidebarOpen: false });
    await this.select(id, path);
  }

  async select(id: string, path: string): Promise<void> {
    const state = this.state;
    if (!state.immersiveView) this.sections.expand("folders");
    const name = findFolderByPath(state.imports, path)?.name ?? path.split("/").filter(Boolean).pop() ?? path;
    state.change({
      mode: "folders",
      pendingRestoreFolderPath: null,
      selectedFolderId: id,
      selectedFolderName: name,
    });
    this.requestImageIndex(path, state.includeSubfolders);
    const photos = await this.backend.getPhotosInFolder(path, state.includeSubfolders);
    if (state.selectedFolderId !== id || state.mode !== "folders") return;
    this.photoList.setPhotos(photos);
    if (state.fullViewIndex === null) {
      state.change({ selectedPhoto: null });
    } else if (state.photos.length > 0) {
      state.change({ selectedPhoto: state.photos[0], fullViewIndex: 0 });
    } else {
      state.change({ selectedPhoto: null, fullViewIndex: null });
    }
    void this.backend.setLastFolder(path).catch((error) => console.error("Failed to persist last folder", error));
  }

  clear(): void {
    const state = this.state;
    if (state.selectedFolderId === null) return;
    state.change({ selectedFolderId: null, selectedFolderName: null, selectedPhoto: null, fullViewIndex: null });
    this.photoList.setPhotos([]);
    void this.backend.setLastFolder("").catch((error) => console.error("Failed to clear last folder", error));
  }

  async toggleIncludeSubfolders(): Promise<void> {
    const state = this.state;
    state.change({ includeSubfolders: !state.includeSubfolders });
    if (!state.selectedFolderId) return;
    try {
      await this.reloadSelected();
      state.change({ selectedPhoto: null, fullViewIndex: null });
    } catch (error) {
      console.error("Failed to toggle subfolder inclusion", error);
    }
  }

  async reloadSelected(): Promise<void> {
    const folderPath = this.state.selectedFolderId;
    if (!folderPath) return;
    this.requestImageIndex(folderPath, this.state.includeSubfolders);
    this.photoList.setPhotos(await this.backend.getPhotosInFolder(folderPath, this.state.includeSubfolders));
  }

  async refreshFromIndex(): Promise<void> {
    const folderPath = this.state.selectedFolderId;
    if (!folderPath) return;
    try {
      const photos = await this.backend.getPhotosInFolder(folderPath, this.state.includeSubfolders);
      if (this.state.selectedFolderId === folderPath) this.photoList.setPhotos(photos);
    } catch (error) {
      console.error("Failed to load indexed folder images", error);
    }
  }

  requestImageIndex(folderPath: string, recursive: boolean): void {
    void this.backend
      .indexFolderImages(folderPath, recursive)
      .catch((error) => console.error("Failed to queue folder image indexing", error));
  }
}

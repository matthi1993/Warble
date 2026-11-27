import { Debouncer, DisposableBag } from "@warble/core";
import {
  findFolderByPath,
  type FolderBackend,
  type FolderImageUpdate,
  type FolderUpdate,
  type PhotoBackend,
} from "@warble/library";
import type { FolderCountsController } from "./folder-counts-controller";
import type { FolderScanTasks } from "./folder-scan-tasks";
import type { FolderSelectionController } from "./folder-selection-controller";
import type { FoldersController } from "./folders-controller";
import type { LibraryPhotosController } from "./library-photos-controller";
import type { PhotoListController } from "./photo-list-controller";
import type { ShellState } from "./shell-state";

const IMAGE_REFRESH_DELAY_MS = 100;

export type FolderEventsBackend = Pick<
  FolderBackend,
  "onFoldersRehydrated" | "onFolderScanProgress" | "onFoldersUpdated" | "onFolderImagesUpdated"
> &
  Pick<PhotoBackend, "getPhotosInFolder">;

export class FolderEventsController {
  private readonly subscriptions = new DisposableBag();
  private readonly imageRefresh = new Debouncer(
    IMAGE_REFRESH_DELAY_MS,
    () => void this.folderSelection.refreshFromIndex(),
  );

  constructor(
    private readonly state: ShellState,
    private readonly backend: FolderEventsBackend,
    private readonly scanTasks: FolderScanTasks,
    private readonly folders: Pick<FoldersController, "rehydrated">,
    private readonly folderSelection: Pick<FolderSelectionController, "select" | "refreshFromIndex" | "requestImageIndex">,
    private readonly photoList: Pick<PhotoListController, "setPhotos">,
    private readonly counts: Pick<FolderCountsController, "refresh">,
    private readonly libraryPhotos: Pick<LibraryPhotosController, "refresh">,
  ) {}

  async subscribe(): Promise<void> {
    const backend = this.backend;
    this.subscriptions.add(await backend.onFoldersRehydrated(() => void this.folders.rehydrated()));
    this.subscriptions.add(await backend.onFolderScanProgress((progress) => this.scanTasks.report(progress)));
    this.subscriptions.add(await backend.onFoldersUpdated((update) => void this.foldersUpdated(update)));
    this.subscriptions.add(await backend.onFolderImagesUpdated((update) => this.folderImagesUpdated(update)));
  }

  dispose(): void {
    this.subscriptions.dispose();
    this.imageRefresh.cancel();
    this.scanTasks.cancelAll();
  }

  async foldersUpdated(update: FolderUpdate): Promise<void> {
    const state = this.state;
    state.change({ imports: update.folders });
    if (!update.contentChanged) return;
    const root = state.imports.find((item) => item.id === update.rootId);
    if (root?.available) this.folderSelection.requestImageIndex(root.path, true);
    if (state.pendingRestoreFolderPath) {
      const restored = findFolderByPath(state.imports, state.pendingRestoreFolderPath);
      if (restored) {
        state.change({ pendingRestoreFolderPath: null });
        await this.folderSelection.select(restored.id, restored.path);
        return;
      }
    }
    const selectedPath = state.selectedFolderId;
    if (!selectedPath || !this.scanTouchesSelection(update.folderKey, selectedPath)) return;
    try {
      this.folderSelection.requestImageIndex(selectedPath, state.includeSubfolders);
      const selected = findFolderByPath(state.imports, selectedPath);
      if (selected) {
        const photos = await this.backend.getPhotosInFolder(selected.path, state.includeSubfolders);
        if (state.selectedFolderId === selectedPath) this.photoList.setPhotos(photos);
        return;
      }
      const fallback = findFolderByPath(state.imports, update.folderKey);
      if (fallback) await this.folderSelection.select(fallback.id, fallback.path);
    } catch (error) {
      console.error("Failed to refresh photos after folder scan", error);
    }
  }

  folderImagesUpdated(update: FolderImageUpdate): void {
    const state = this.state;
    void this.counts.refresh();
    void this.libraryPhotos.refresh();
    if (state.mode === "allPhotos" || state.mode === "favorites") return;
    const selectedPath = state.selectedFolderId;
    if (!selectedPath) return;
    const affectsSelection =
      update.folderKey === selectedPath ||
      (state.includeSubfolders && update.folderKey.startsWith(`${selectedPath}/`));
    if (affectsSelection) this.imageRefresh.schedule();
  }

  private scanTouchesSelection(scannedKey: string, selectedPath: string): boolean {
    const selectedInsideScan = selectedPath === scannedKey || selectedPath.startsWith(`${scannedKey}/`);
    const scanInsideRecursiveSelection =
      this.state.includeSubfolders && scannedKey.startsWith(`${selectedPath}/`);
    return selectedInsideScan || scanInsideRecursiveSelection;
  }
}

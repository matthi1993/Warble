import type { BusyState } from "@warble/core";
import { findFolderByPath, type Folder, type FolderBackend } from "@warble/library";
import type { Dialogs } from "@app/platform/desktop";
import type { BrowserEnvironment } from "./browser-environment";
import type { FolderSelectionController } from "./folder-selection-controller";
import type { PhotoDataSync } from "./photo-data-sync";
import type { ShellState } from "./shell-state";

export type FoldersBackend = Pick<
  FolderBackend,
  | "listImportedFolders"
  | "refreshImportedFolders"
  | "refreshFolder"
  | "removeImportedFolder"
  | "selectFoldersDialog"
  | "bindMediaRoot"
  | "importFolders"
>;

export class FoldersController {
  constructor(
    private readonly state: ShellState,
    private readonly backend: FoldersBackend,
    private readonly dialogs: Pick<Dialogs, "message">,
    private readonly busy: Pick<BusyState, "begin">,
    private readonly environment: Pick<BrowserEnvironment, "waitForPaint">,
    private readonly photoData: PhotoDataSync,
    private readonly folderSelection: Pick<FolderSelectionController, "select" | "clear">,
  ) {}

  async loadImported(): Promise<void> {
    try {
      const persisted = await this.backend.listImportedFolders();
      if (persisted.length > 0) this.state.change({ imports: persisted });
    } catch (error) {
      console.error("Failed to load imported folders", error);
    }
  }

  async import(): Promise<void> {
    const state = this.state;
    const endBusy = this.busy.begin("Adding folders…");
    try {
      await this.environment.waitForPaint();
      const selections = await this.backend.selectFoldersDialog();
      if (!selections || selections.length === 0) return;
      // The picker order is kept: the backend relies on it to consolidate nested or overlapping roots.
      const result = await this.backend.importFolders(selections);
      state.change({ imports: result.folders });
      await this.photoData.reloadAll();
      if (!this.selectionWasReplaced()) return;
      const replacement = result.imported
        .map((folder) => findFolderByPath(state.imports, folder.path))
        .find((folder): folder is Folder => folder !== null);
      if (replacement) await this.folderSelection.select(replacement.id, replacement.path);
    } catch (error) {
      console.error("Failed to import media root", error);
      void this.dialogs.message(`Failed to add folders: ${error}`, { title: "Add Folders", kind: "error" });
    } finally {
      endBusy();
    }
  }

  async reconnect(rootId: string): Promise<void> {
    const state = this.state;
    const endBusy = this.busy.begin("Reconnecting folder…");
    try {
      await this.environment.waitForPaint();
      const selection = (await this.backend.selectFoldersDialog())?.[0];
      if (!selection) return;
      await this.photoData.flushPendingWrites();
      state.change({ imports: await this.backend.bindMediaRoot(rootId, selection.path, selection.bookmark) });
      await this.photoData.reloadAll();
      if (!this.selectionWasReplaced()) return;
      const replacement = state.imports.find((folder) => folder.available);
      if (replacement) await this.folderSelection.select(replacement.id, replacement.path);
    } catch (error) {
      console.error("Failed to reconnect media root", error);
      void this.dialogs.message(`Failed to reconnect folder: ${error}`, { title: "Reconnect Folder", kind: "error" });
    } finally {
      endBusy();
    }
  }

  async refreshAll(): Promise<void> {
    try {
      await this.photoData.flushPendingWrites();
      this.state.change({ imports: await this.backend.refreshImportedFolders() });
    } catch (error) {
      console.error("Failed to refresh imported folders", error);
    }
  }

  async sync(path: string, name: string): Promise<void> {
    this.state.change({ folderMenu: null });
    try {
      await this.photoData.flushPendingWrites();
      this.state.change({ imports: await this.backend.refreshFolder(path) });
    } catch (error) {
      console.error(`Failed to sync ${name}`, error);
    }
  }

  async remove(rootId: string): Promise<void> {
    const state = this.state;
    state.change({ folderMenu: null });
    const endBusy = this.busy.begin("Removing folder…");
    try {
      await this.environment.waitForPaint();
      this.photoData.forgetRoot(rootId);
      await this.photoData.flushPendingWrites();
      state.change({ imports: await this.backend.removeImportedFolder(rootId) });
      const selectedIsInsideRoot =
        state.selectedFolderId === rootId || state.selectedFolderId?.startsWith(`${rootId}/`) === true;
      if (selectedIsInsideRoot) this.folderSelection.clear();
    } catch (error) {
      console.error("Failed to remove imported folder", error);
    } finally {
      endBusy();
    }
  }

  /** iOS finishes restoring folder permissions after the shell is visible. */
  async rehydrated(): Promise<void> {
    const state = this.state;
    await this.photoData.reloadAll();
    try {
      state.change({ imports: await this.backend.listImportedFolders() });
    } catch (error) {
      console.error("Failed to load restored folders", error);
      return;
    }
    if (state.hasSelection) return;
    const first = state.imports.find((folder) => folder.available);
    if (first) await this.folderSelection.select(first.id, first.path);
  }

  private selectionWasReplaced(): boolean {
    const selected = this.state.selectedFolderId;
    return !!selected && !findFolderByPath(this.state.imports, selected);
  }
}

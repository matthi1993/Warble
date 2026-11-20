import type { SettingsBackend } from "@app/platform/settings-backend";
import type { FolderSelectionController } from "./folder-selection-controller";
import type { ShellChanges, ShellFieldName, ShellState } from "./shell-state";

const PERSISTED_FIELDS: readonly ShellFieldName[] = [
  "selectedPhoto",
  "fullViewIndex",
  "sidebarCollapsed",
  "editPanelOpen",
  "includeSubfolders",
];

export class AppViewController {
  private hydrated = false;

  constructor(
    private readonly state: ShellState,
    private readonly settings: Pick<SettingsBackend, "getAppView" | "setAppView">,
    private readonly folderSelection: Pick<FolderSelectionController, "reloadSelected">,
  ) {}

  /** Runs after the last folder was restored, so the persisted photo can be found in the list. */
  async restore(): Promise<void> {
    const state = this.state;
    try {
      const persisted = await this.settings.getAppView();
      if (!persisted) return;
      if (typeof persisted.sidebarCollapsed === "boolean") {
        state.change({ sidebarCollapsed: persisted.sidebarCollapsed });
      }
      if (typeof persisted.editPanelOpen === "boolean") state.change({ editPanelOpen: persisted.editPanelOpen });
      if (typeof persisted.includeSubfolders === "boolean") {
        state.change({ includeSubfolders: persisted.includeSubfolders });
        if (state.includeSubfolders && state.selectedFolderId) await this.showSubfolderPhotos();
      }
      if (!persisted.path) return;
      const index = state.photos.findIndex((photo) => photo.path === persisted.path);
      if (index < 0) return;
      state.change({ selectedPhoto: state.photos[index] });
      if (persisted.view === "full") state.change({ fullViewIndex: index });
    } catch (error) {
      console.error("Failed to restore last view", error);
    } finally {
      this.hydrated = true;
    }
  }

  persistChanges(changes: ShellChanges): void {
    if (!this.hydrated || !PERSISTED_FIELDS.some((field) => changes.has(field))) return;
    void this.persist();
  }

  private async showSubfolderPhotos(): Promise<void> {
    try {
      await this.folderSelection.reloadSelected();
    } catch (error) {
      console.error("Failed to refresh photos with subfolders", error);
    }
  }

  private async persist(): Promise<void> {
    const state = this.state;
    try {
      await this.settings.setAppView({
        path: state.selectedPhoto?.path ?? null,
        view: state.fullViewIndex !== null ? "full" : "grid",
        sidebarCollapsed: state.sidebarCollapsed,
        editPanelOpen: state.editPanelOpen,
        includeSubfolders: state.includeSubfolders,
      });
    } catch (error) {
      console.warn("Failed to persist app view", error);
    }
  }
}

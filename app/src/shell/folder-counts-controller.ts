import type { FolderBackend } from "@warble/library";
import type { FolderSelectionController } from "./folder-selection-controller";
import type { ShellState } from "./shell-state";

export class FolderCountsController {
  private readonly indexedRoots = new Set<string>();
  private request = 0;

  constructor(
    private readonly state: ShellState,
    private readonly backend: Pick<FolderBackend, "getFolderPhotoCounts">,
    private readonly folderSelection: Pick<FolderSelectionController, "requestImageIndex">,
  ) {}

  async refresh(): Promise<void> {
    const request = ++this.request;
    try {
      const counts = await this.backend.getFolderPhotoCounts();
      if (request === this.request) this.state.change({ folderPhotoCounts: counts });
    } catch (error) {
      console.error("Failed to load folder photo counts", error);
    }
  }

  /** Counts need every root indexed once, including folders the user never opened. */
  indexNewRoots(): void {
    const available = this.state.imports.filter((root) => root.available);
    const availableIds = new Set(available.map((root) => root.id));
    for (const id of this.indexedRoots) {
      if (!availableIds.has(id)) this.indexedRoots.delete(id);
    }
    for (const root of available) {
      if (this.indexedRoots.has(root.id)) continue;
      this.indexedRoots.add(root.id);
      this.folderSelection.requestImageIndex(root.path, true);
    }
  }
}

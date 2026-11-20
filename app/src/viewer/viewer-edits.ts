import { EMPTY_RECIPE, normalizeRotation, type RenderRecipe } from "@warble/render";
import type { EditStatePort, SavedCrop } from "./edit-state-port";
import type { ViewerSettings } from "./viewer-settings";

export class ViewerEdits {
  savedCrop: SavedCrop | null = null;
  postEnabled: boolean;

  constructor(
    private readonly settings: ViewerSettings,
    private readonly state: EditStatePort,
  ) {
    this.postEnabled = state.postEnabled();
  }

  refreshSavedCrop(): void {
    this.savedCrop = this.state.crop(this.settings.path);
  }

  cropEnabled(): boolean {
    return this.state.cropEnabled(this.settings.path);
  }

  /** The crop tool shows the whole image so it can be re-framed. */
  appliedCrop(): SavedCrop | null {
    if (this.settings.cropMode || !this.cropEnabled()) return null;
    return this.savedCrop;
  }

  /** The crop tool previews its live rotation; otherwise the saved one applies. */
  rotation(): number {
    if (!this.cropEnabled()) return 0;
    const degrees = this.settings.cropMode ? this.settings.rotation || 0 : this.savedCrop?.rotation ?? 0;
    return normalizeRotation(degrees);
  }

  recipe(): RenderRecipe {
    if (this.settings.previewOriginal) return EMPTY_RECIPE;
    const path = this.settings.path;
    return {
      photo: this.state.layer("photo", path),
      post: this.postEnabled ? this.state.layer("post", path) : EMPTY_RECIPE.post,
    };
  }
}

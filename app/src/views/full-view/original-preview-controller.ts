import type { RecipeBuilder } from "@warble/editing";
import type { StageModel } from "./stage-model";
import type { UpdateHost } from "./update-host";

export class OriginalPreviewController {
  private shown = false;

  constructor(
    private readonly host: UpdateHost,
    private readonly stage: Pick<StageModel, "editTarget">,
    private readonly recipes: Pick<RecipeBuilder, "hasVisibleEdits">,
  ) {}

  get showing(): boolean {
    return this.shown;
  }

  get available(): boolean {
    const target = this.stage.editTarget;
    return target !== null && this.recipes.hasVisibleEdits(target);
  }

  /** Returns `false` when the original would look the same as the edited image. */
  begin(): boolean {
    if (!this.available) return false;
    this.show(true);
    return true;
  }

  show(shown: boolean): void {
    if (this.shown === shown) return;
    this.shown = shown;
    this.host.requestUpdate();
  }
}

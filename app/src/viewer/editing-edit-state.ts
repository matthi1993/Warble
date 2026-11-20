import type { EditingContext, RecipeBuilder } from "@warble/editing";
import type { EffectLayer, LayerId } from "@warble/render";
import type { EditStateListener, EditStatePort, SavedCrop } from "./edit-state-port";

export class EditingEditState implements EditStatePort {
  constructor(
    private readonly editing: EditingContext,
    private readonly recipes: RecipeBuilder,
  ) {}

  crop(path: string | null): SavedCrop | null {
    return path ? this.editing.photoEdits.crop(path) : null;
  }

  cropEnabled(path: string | null): boolean {
    return this.recipes.cropEnabled(path);
  }

  postEnabled(): boolean {
    return this.editing.post.enabled;
  }

  layer(layer: LayerId, path: string | null): EffectLayer {
    return layer === "photo" ? this.recipes.photoLayer(path) : this.recipes.postLayer(path);
  }

  subscribe(listener: EditStateListener): () => void {
    const { photoEdits, post, toggles } = this.editing;
    const subscriptions = [
      photoEdits.subscribe(({ path, payload }) => {
        const concernsShownPhoto = path === null || path === listener.path();
        if (payload === "effects") {
          if (concernsShownPhoto) listener.onEffects();
        } else if (listener.path() && concernsShownPhoto) {
          listener.onEdit(path ?? "");
        }
      }),
      post.subscribe((settings) => listener.onPostEnabled(settings.enabled)),
      toggles.subscribe(({ scope, path, id }) => {
        if (scope !== "photo" || path === listener.path()) listener.onEffectEnabled(scope, id);
      }),
    ];
    return () => subscriptions.forEach((unsubscribe) => unsubscribe());
  }
}

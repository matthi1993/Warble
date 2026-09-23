import type { CropEdit } from "@domain/edits";
import { getPhotoEdit, subscribePhotoEdits } from "@services/edits/edits-store";
import { subscribePhotoEffects } from "@services/effects/effects-store";
import { isEffectEnabled, subscribeEffectEnabled } from "@services/effects/effect-enabled-store";
import { getPostProcess, subscribePostProcess, type PostProcessSettings } from "@services/post-process/post-process-store";
import { readEditorToolValues } from "@features/editor/registry";
import { editorStateAdapter } from "@features/editor/adapters/store-state";

export interface CanvasEditEvents {
  readonly path: () => string | null;
  onEdit(path: string): void;
  onPostProcess(settings: PostProcessSettings): void;
  onEffects(): void;
  onEffectEnabled(scope: "photo" | "post", id: string): void;
}

export const canvasState = {
  getCrop(path: string | null): CropEdit | null {
    return path ? getPhotoEdit(path)?.crop ?? null : null;
  },
  getPostProcess,
  cropEnabled(path: string | null): boolean {
    return isEffectEnabled("photo", path, "all") && isEffectEnabled("photo", path, "crop");
  },
  readValues(scope: "photo" | "post", path: string | null): Readonly<Record<string, unknown>> {
    return readEditorToolValues(scope, path, editorStateAdapter);
  },
  subscribe(events: CanvasEditEvents): () => void {
    const unsubscribe = [
      subscribePhotoEdits((path) => {
        if (events.path() && (!path || path === events.path())) events.onEdit(path);
      }),
      subscribePostProcess((settings) => events.onPostProcess(settings)),
      subscribePhotoEffects((path) => {
        if (!path || path === events.path()) events.onEffects();
      }),
      subscribeEffectEnabled(({ scope, path, id }) => {
        if (scope !== "photo" || path === events.path()) events.onEffectEnabled(scope, id);
      }),
    ];
    return () => unsubscribe.forEach((stop) => stop());
  },
};

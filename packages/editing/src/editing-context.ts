import { EffectCatalog } from "./effects/effect-catalog";
import { PhotoEditStore } from "./photo/photo-edit-store";
import type { EditRepository } from "./ports/edit-repository";
import type { KeyValueStorage } from "./ports/key-value-storage";
import { PostProcessStore } from "./post/post-process-store";
import { PresetStore } from "./presets/preset-store";
import { EffectToggleStore } from "./toggles/effect-toggle-store";

export class EditingContext {
  constructor(
    readonly effects: EffectCatalog,
    readonly photoEdits: PhotoEditStore,
    readonly post: PostProcessStore,
    readonly presets: PresetStore,
    readonly toggles: EffectToggleStore,
  ) {}

  static create(
    repository: EditRepository,
    storage: KeyValueStorage | null,
    effects: EffectCatalog = EffectCatalog.standard(),
  ): EditingContext {
    return new EditingContext(
      effects,
      new PhotoEditStore(repository, effects, storage),
      new PostProcessStore(storage, effects),
      new PresetStore(repository, effects, storage),
      new EffectToggleStore(storage),
    );
  }

  async load(): Promise<void> {
    await Promise.all([this.photoEdits.load(), this.presets.load()]);
  }
}

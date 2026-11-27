import {
  BASE_TONE_KEYS,
  DYNAMIC_RANGE_KEYS,
  EMPTY_RECIPE,
  type EffectId,
  type EffectLayer,
  type EffectSettingsMap,
  type LayerId,
  type RenderRecipe,
  type ToneEdit,
} from "@warble/render";
import type { CropEdit } from "../crop/crop-edit";
import type { EditingContext } from "../editing-context";
import { ALL_EDITS_TOGGLE, BASE_TONE_TOGGLE, CROP_TOGGLE, DYNAMIC_RANGE_TOGGLE } from "../toggles/toggle-ids";

export interface RecipeOptions {
  /** Compare with original: nothing is applied. */
  readonly original?: boolean;
  /** Saving a variant bakes in only the photo's own edits. */
  readonly includePost?: boolean;
}

type ReadEffect = <K extends EffectId>(id: K) => EffectSettingsMap[K] | null;

export class RecipeBuilder {
  constructor(private readonly context: EditingContext) {}

  build(path: string | null, options: RecipeOptions = {}): RenderRecipe {
    if (options.original) return EMPTY_RECIPE;
    return {
      photo: this.photoLayer(path),
      post: options.includePost === false ? {} : this.postLayer(path),
    };
  }

  photoLayer(path: string | null): EffectLayer {
    const { photoEdits, toggles } = this.context;
    if (!path || !toggles.isEnabled("photo", path, ALL_EDITS_TOGGLE)) return {};
    return this.layer("photo", path, (id) => photoEdits.effect(path, id));
  }

  postLayer(path: string | null): EffectLayer {
    const { post } = this.context;
    if (!post.enabled) return {};
    return this.layer("post", path, (id) => post.effect(id));
  }

  crop(path: string | null, options: RecipeOptions = {}): CropEdit | null {
    if (!path || options.original || !this.cropEnabled(path)) return null;
    return this.context.photoEdits.crop(path);
  }

  cropEnabled(path: string | null): boolean {
    const { toggles } = this.context;
    return toggles.isEnabled("photo", path, ALL_EDITS_TOGGLE) && toggles.isEnabled("photo", path, CROP_TOGGLE);
  }

  /** True when "compare with original" would show a difference. Photo edits count even while toggled off. */
  hasVisibleEdits(path: string): boolean {
    const { photoEdits, effects } = this.context;
    return photoEdits.hasEdits(path) || !effects.registry.isLayerNeutral(this.postLayer(path));
  }

  private layer(scope: LayerId, path: string | null, read: ReadEffect): EffectLayer {
    const { effects, toggles } = this.context;
    const layer: Partial<Record<EffectId, unknown>> = {};
    for (const id of effects.ids) {
      if (!toggles.isEnabled(scope, path, id)) continue;
      const settings = read(id);
      if (settings) layer[id] = id === "tone" ? this.toggledTone(scope, path, settings as ToneEdit) : settings;
    }
    return layer as EffectLayer;
  }

  private toggledTone(scope: LayerId, path: string | null, tone: ToneEdit): ToneEdit {
    const { effects, toggles } = this.context;
    const neutral = effects.defaults("tone");
    const result = { ...tone };
    if (!toggles.isEnabled(scope, path, BASE_TONE_TOGGLE)) {
      for (const key of BASE_TONE_KEYS) result[key] = neutral[key];
    }
    if (!toggles.isEnabled(scope, path, DYNAMIC_RANGE_TOGGLE)) {
      for (const key of DYNAMIC_RANGE_KEYS) result[key] = neutral[key];
    }
    return result;
  }
}

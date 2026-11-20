import { AnalogEffect } from "./analog/analog-effect";
import { BloomEffect } from "./bloom/bloom-effect";
import { ClarityEffect } from "./clarity/clarity-effect";
import { ColorEffect } from "./color/color-effect";
import { CurveEffect } from "./curve/curve-effect";
import type { Effect } from "./effect";
import { GrainEffect } from "./grain/grain-effect";
import { ShaderEffect } from "./shader-effect";
import { SharpenEffect } from "./sharpen/sharpen-effect";
import { ToneEffect } from "./tone/tone-effect";
import { layerSettings, type EffectLayer, type RenderRecipe } from "../recipe/render-recipe";

export class EffectRegistry {
  constructor(readonly effects: readonly Effect<unknown>[]) {}

  /** The order is the order in which shader effects are applied within a layer. */
  static standard(): EffectRegistry {
    return new EffectRegistry([
      new ToneEffect(),
      new ClarityEffect(),
      new ColorEffect(),
      new CurveEffect(),
      new SharpenEffect(),
      new BloomEffect(),
      new GrainEffect(),
      new AnalogEffect(),
    ]);
  }

  get shaderEffects(): ShaderEffect<unknown>[] {
    return this.effects.filter((effect): effect is ShaderEffect<unknown> => effect instanceof ShaderEffect);
  }

  get(id: string): Effect<unknown> | undefined {
    return this.effects.find((effect) => effect.id === id);
  }

  isLayerNeutral(layer: EffectLayer): boolean {
    return this.effects.every((effect) => effect.isNeutral(layerSettings(layer, effect.id)));
  }

  isNeutral(recipe: RenderRecipe): boolean {
    return this.isLayerNeutral(recipe.photo) && this.isLayerNeutral(recipe.post);
  }
}

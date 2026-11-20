import type { AnalogSettings } from "../effects/analog/analog-settings";
import type { BloomSettings } from "../effects/bloom/bloom-settings";
import type { ClaritySettings } from "../effects/clarity/clarity-settings";
import type { ColorEdit } from "../effects/color/color-settings";
import type { CurveEdit } from "../effects/curve/curve-settings";
import type { GrainSettings } from "../effects/grain/grain-settings";
import type { SharpenSettings } from "../effects/sharpen/sharpen-settings";
import type { ToneEdit } from "../effects/tone/tone-settings";

export interface EffectSettingsMap {
  tone: ToneEdit;
  clarity: ClaritySettings;
  color: ColorEdit;
  curve: CurveEdit;
  sharpen: SharpenSettings;
  bloom: BloomSettings;
  grain: GrainSettings;
  analog: AnalogSettings;
}

export type EffectId = keyof EffectSettingsMap;
export type LayerId = "photo" | "post";
export type EffectLayer = { readonly [K in EffectId]?: EffectSettingsMap[K] | null };

/** What to do with an image: the photo's own edits, then the global look. */
export interface RenderRecipe {
  readonly photo: EffectLayer;
  readonly post: EffectLayer;
}

export const EMPTY_RECIPE: RenderRecipe = { photo: {}, post: {} };

export function layerSettings<S>(layer: EffectLayer, effectId: string): S | null {
  return ((layer as Readonly<Record<string, unknown>>)[effectId] as S | null | undefined) ?? null;
}

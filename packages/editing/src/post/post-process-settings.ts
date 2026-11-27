import type { EffectSettingsMap } from "@warble/render";

export interface PostProcessSettings extends EffectSettingsMap {
  /** Master switch: when false the Post layer is skipped but its settings are kept. */
  enabled: boolean;
}

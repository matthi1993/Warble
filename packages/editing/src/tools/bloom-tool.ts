import type { BloomSettings } from "@warble/render";
import { EffectTool } from "./effect-tool";
import type { ToolHost } from "./tool-host";

/** Bloom exists only in Post, so its edit state does not depend on the photo. */
export class BloomTool extends EffectTool<"bloom"> {
  readonly id = "bloom";

  hasEdits(): boolean {
    return !this.context.effects.isNeutral("bloom", this.context.post.effect("bloom"));
  }

  /** Unlike other effects, any changed slider can be reverted even while the strength is zero. */
  canRevert(host: ToolHost): boolean {
    const settings = this.value(host);
    const defaults = this.context.effects.defaults("bloom");
    return (Object.keys(defaults) as (keyof BloomSettings)[]).some((key) => settings[key] !== defaults[key]);
  }
}

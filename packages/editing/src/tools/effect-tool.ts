import type { EffectId, EffectSettingsMap } from "@warble/render";
import { EditTool } from "./edit-tool";
import type { ToolHost } from "./tool-host";

/**
 * A tool that edits the settings of one registered effect. The tool id is the effect id,
 * so a new effect tool only has to declare its `id`.
 */
export abstract class EffectTool<K extends EffectId> extends EditTool {
  abstract readonly id: K;

  /** What the card shows: the Post value, or the photo's value with defaults when it has none. */
  value(host: ToolHost): EffectSettingsMap[K] {
    if (this.scope === "post") return this.context.post.effect(this.id);
    return this.stored(host.editTarget) ?? this.context.effects.defaults(this.id);
  }

  stored(target: string | null): EffectSettingsMap[K] | null {
    return target ? this.context.photoEdits.effect(target, this.id) : null;
  }

  change(host: ToolHost, settings: EffectSettingsMap[K]): void {
    if (this.scope === "post") this.context.post.setEffect(this.id, settings);
    else if (host.editTarget) this.context.photoEdits.setEffect(host.editTarget, this.id, settings);
    host.requestUpdate();
  }

  canRevert(host: ToolHost): boolean {
    if (this.scope === "post") return !this.context.effects.isNeutral(this.id, this.value(host));
    return host.editTarget ? this.hasEdits(host.editTarget) : false;
  }

  hasEdits(target: string): boolean {
    return this.context.photoEdits.hasEffect(target, this.id);
  }

  reset(host: ToolHost): void {
    if (this.scope === "post") this.context.post.resetEffect(this.id);
    else if (host.editTarget) this.context.photoEdits.setEffect(host.editTarget, this.id, null);
    host.requestUpdate();
  }

  serializeEdit(target: string): unknown | null {
    const settings = this.stored(target);
    return settings ? structuredClone(settings) : null;
  }

  applyEdit(host: ToolHost, data: unknown): void {
    if (this.scope !== "photo" || !host.editTarget) return;
    const settings = data == null ? null : structuredClone(data as EffectSettingsMap[K]);
    this.context.photoEdits.setEffect(host.editTarget, this.id, settings);
    host.requestUpdate();
  }
}

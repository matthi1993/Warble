import { BASE_TONE_KEYS, DYNAMIC_RANGE_KEYS, isBaseToneZero, isDynamicRangeZero, type ToneEdit } from "@warble/render";
import { EffectTool } from "./effect-tool";
import type { ToolHost } from "./tool-host";

/** Shown as two cards, base tone and dynamic range, that share one tone value. */
export class ToneTool extends EffectTool<"tone"> {
  readonly id = "tone";

  dynamicRangeCardOpen = false;

  setDynamicRangeCardOpen(host: ToolHost, open: boolean): void {
    this.dynamicRangeCardOpen = open;
    host.requestUpdate();
  }

  setKey(host: ToolHost, key: keyof ToneEdit, value: number): void {
    this.change(host, { ...this.value(host), [key]: value });
  }

  resetKey(host: ToolHost, key: keyof ToneEdit): void {
    this.setKey(host, key, 0);
  }

  resetBaseTone(host: ToolHost): void {
    if (!isBaseToneZero(this.value(host))) this.resetKeys(host, BASE_TONE_KEYS);
  }

  resetDynamicRange(host: ToolHost): void {
    if (!isDynamicRangeZero(this.value(host))) this.resetKeys(host, DYNAMIC_RANGE_KEYS);
  }

  private resetKeys(host: ToolHost, keys: readonly (keyof ToneEdit)[]): void {
    const tone = { ...this.value(host) };
    for (const key of keys) tone[key] = 0;
    this.change(host, tone);
  }
}

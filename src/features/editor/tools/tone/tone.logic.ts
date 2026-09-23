import { html, type TemplateResult } from "lit";
import {
  BASE_TONE_KEYS,
  DYNAMIC_RANGE_KEYS,
  defaultTone,
  isBaseToneZero,
  isDynamicRangeZero,
  isToneZero,
  type ToneEdit,
} from "@domain/edits";
import { getPhotoEdit, setPhotoTone } from "@services/edits/edits-store";
import {
  getPostProcess,
  resetPostTone,
  setPostTone,
} from "@services/post-process/post-process-store";
import { EditTool, type ToolHost, type ToolScope } from "../../tool";
import "./tone.ui";

export function readToneToolValue(scope: ToolScope, path: string | null): ToneEdit {
  if (scope === "post") return getPostProcess().tone;
  return (path ? getPhotoEdit(path)?.tone : null) ?? defaultTone();
}

export class ToneTool extends EditTool {
  readonly id = "tone";
  dynamicRangeCardOpen = false;

  private value(host: ToolHost): ToneEdit {
    return readToneToolValue(this.scope, host.editTarget);
  }

  private write(host: ToolHost, value: ToneEdit | null): void {
    if (this.scope === "post") setPostTone(value ?? defaultTone());
    else if (host.editTarget) setPhotoTone(host.editTarget, value);
    host.requestUpdate();
  }

  hasEdits(target: string): boolean {
    return !isToneZero(getPhotoEdit(target)?.tone);
  }

  serializeEdit(target: string): unknown | null {
    const value = getPhotoEdit(target)?.tone;
    return value ? { ...value } : null;
  }

  applyEdit(host: ToolHost, data: unknown): void {
    if (this.scope !== "photo") return;
    const value = data == null ? null : { ...defaultTone(), ...(data as ToneEdit) };
    this.write(host, value && !isToneZero(value) ? value : null);
  }

  reset(host: ToolHost): void {
    if (this.scope === "post") {
      resetPostTone();
      host.requestUpdate();
    } else {
      this.write(host, null);
    }
  }

  private resetKeys(host: ToolHost, keys: readonly (keyof ToneEdit)[]): void {
    const next = { ...this.value(host) };
    for (const key of keys) next[key] = 0;
    this.write(host, isToneZero(next) && this.scope === "photo" ? null : next);
  }

  renderCard(host: ToolHost): TemplateResult {
    const tone = this.value(host);
    return html`
      <pf-basic-card
        .tone=${tone}
        ?open=${this.cardOpen}
        .effectDisabled=${this.effectDisabled(host, "base-tone")}
        @effect-toggle=${() => this.toggleEffect(host, "base-tone")}
        @toggle=${(event: CustomEvent<{ open: boolean }>) => {
          this.cardOpen = event.detail.open;
          host.requestUpdate();
        }}
        @tone-change=${(event: CustomEvent<{ key: keyof ToneEdit; value: number }>) => {
          const next = { ...tone, [event.detail.key]: event.detail.value };
          this.write(host, isToneZero(next) && this.scope === "photo" ? null : next);
        }}
        @tone-reset-key=${(event: CustomEvent<{ key: keyof ToneEdit }>) => {
          const next = { ...tone, [event.detail.key]: 0 };
          this.write(host, isToneZero(next) && this.scope === "photo" ? null : next);
        }}
        @tone-reset=${() => {
          if (!isBaseToneZero(tone)) this.resetKeys(host, BASE_TONE_KEYS);
        }}
      ></pf-basic-card>
      <pf-dynamic-range-card
        .tone=${tone}
        ?open=${this.dynamicRangeCardOpen}
        .effectDisabled=${this.effectDisabled(host, "dynamic-range")}
        @effect-toggle=${() => this.toggleEffect(host, "dynamic-range")}
        @toggle=${(event: CustomEvent<{ open: boolean }>) => {
          this.dynamicRangeCardOpen = event.detail.open;
          host.requestUpdate();
        }}
        @tone-change=${(event: CustomEvent<{ key: keyof ToneEdit; value: number }>) => {
          const next = { ...tone, [event.detail.key]: event.detail.value };
          this.write(host, isToneZero(next) && this.scope === "photo" ? null : next);
        }}
        @tone-reset-key=${(event: CustomEvent<{ key: keyof ToneEdit }>) => {
          const next = { ...tone, [event.detail.key]: 0 };
          this.write(host, isToneZero(next) && this.scope === "photo" ? null : next);
        }}
        @tone-reset=${() => {
          if (!isDynamicRangeZero(tone)) this.resetKeys(host, DYNAMIC_RANGE_KEYS);
        }}
      ></pf-dynamic-range-card>
    `;
  }
}

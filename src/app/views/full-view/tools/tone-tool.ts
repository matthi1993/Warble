/**
 * Tone tool: temperature / tint / exposure / contrast / saturation
 * (Base Edit) plus whites / highlights / shadows / blacks
 * (Dynamic Range). Owns the local `tone` mirror and routes
 * per-slider edits into the edit store.
 *
 * Unlike the crop tool, tone has no interactive canvas overlay —
 * the canvas reads `ToneEdit` from the edit store via its own
 * `subscribePhotoEdits` subscription. So `applyToCanvas` is a
 * no-op; we just push through the store.
 */
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
import {
  getPhotoEdit,
  setPhotoTone,
} from "@services/edits/edits-store";
import "../pf-basic-card";
import "../pf-dynamic-range-card";
import { EditTool, type ToolHost } from "./edit-tool";

export class ToneTool extends EditTool {
  readonly id = "tone";

  tone: ToneEdit = defaultTone();
  /** Path the `tone` mirror was hydrated from. */
  private toneForPath: string | null = null;
  /** Open-state for the Dynamic Range card. The Base Edit card uses
   *  the inherited `cardOpen` field so the existing
   *  active-tool-focus logic in `pf-edit-side-panel` keeps working. */
  dynamicRangeCardOpen = false;

  syncFromStore(target: string | null): void {
    if (target == null) {
      if (this.toneForPath !== null) {
        this.tone = defaultTone();
        this.toneForPath = null;
      }
      return;
    }
    if (target === this.toneForPath) return;
    const persisted = getPhotoEdit(target)?.tone ?? null;
    this.tone = persisted ? { ...defaultTone(), ...persisted } : defaultTone();
    this.toneForPath = target;
  }

  /** Forget the hydration target so the next `syncFromStore` pulls
   *  fresh data (used when the edit store dispatches a clear). */
  invalidateMirror(): void {
    this.toneForPath = null;
  }

  hasEdits(_target: string): boolean {
    return !isToneZero(this.tone);
  }

  serializeEdit(target: string): unknown | null {
    const tone = getPhotoEdit(target)?.tone ?? null;
    return tone ? { ...tone } : null;
  }

  applyEdit(host: ToolHost, data: unknown): void {
    const target = host.editTarget;
    if (!target) return;
    if (data == null) {
      this.tone = defaultTone();
      this.toneForPath = target;
      setPhotoTone(target, null);
      host.requestUpdate();
      return;
    }
    const tone = { ...defaultTone(), ...(data as ToneEdit) };
    this.tone = tone;
    this.toneForPath = target;
    setPhotoTone(target, isToneZero(tone) ? null : tone);
    host.requestUpdate();
  }

  /** Reset every tone field at once (used when the shell calls
   *  `tool.reset()` — e.g. via a global "revert" command). */
  reset(host: ToolHost): void {
    const target = host.editTarget;
    if (!target) return;
    if (isToneZero(this.tone)) return;
    this.tone = defaultTone();
    this.toneForPath = target;
    setPhotoTone(target, null);
    host.requestUpdate();
  }

  /** Reset just the Base Edit subset (temperature/tint/exposure/
   *  contrast/saturation). Used by the per-card revert button. */
  private resetBase(host: ToolHost): void {
    const target = host.editTarget;
    if (!target) return;
    if (isBaseToneZero(this.tone)) return;
    const next: ToneEdit = { ...this.tone };
    for (const k of BASE_TONE_KEYS) next[k] = 0;
    this.tone = next;
    this.toneForPath = target;
    setPhotoTone(target, isToneZero(next) ? null : next);
    host.requestUpdate();
  }

  /** Reset just the Dynamic Range subset. */
  private resetDynamicRange(host: ToolHost): void {
    const target = host.editTarget;
    if (!target) return;
    if (isDynamicRangeZero(this.tone)) return;
    const next: ToneEdit = { ...this.tone };
    for (const k of DYNAMIC_RANGE_KEYS) next[k] = 0;
    this.tone = next;
    this.toneForPath = target;
    setPhotoTone(target, isToneZero(next) ? null : next);
    host.requestUpdate();
  }

  renderCard(host: ToolHost): TemplateResult {
    return html`
      <pf-basic-card
        .tone=${this.tone}
        ?open=${this.cardOpen}
        @toggle=${(e: CustomEvent<{ open: boolean }>) => {
          this.cardOpen = e.detail.open;
          host.requestUpdate();
        }}
        @tone-change=${(
          e: CustomEvent<{ key: keyof ToneEdit; value: number }>
        ) => this.onToneChange(host, e.detail.key, e.detail.value)}
        @tone-reset-key=${(e: CustomEvent<{ key: keyof ToneEdit }>) => {
          if (this.tone[e.detail.key] === 0) return;
          this.onToneChange(host, e.detail.key, 0);
        }}
        @tone-reset=${() => this.resetBase(host)}
      ></pf-basic-card>
      <pf-dynamic-range-card
        .tone=${this.tone}
        ?open=${this.dynamicRangeCardOpen}
        @toggle=${(e: CustomEvent<{ open: boolean }>) => {
          this.dynamicRangeCardOpen = e.detail.open;
          host.requestUpdate();
        }}
        @tone-change=${(
          e: CustomEvent<{ key: keyof ToneEdit; value: number }>
        ) => this.onToneChange(host, e.detail.key, e.detail.value)}
        @tone-reset-key=${(e: CustomEvent<{ key: keyof ToneEdit }>) => {
          if (this.tone[e.detail.key] === 0) return;
          this.onToneChange(host, e.detail.key, 0);
        }}
        @tone-reset=${() => this.resetDynamicRange(host)}
      ></pf-dynamic-range-card>
    `;
  }

  private onToneChange(
    host: ToolHost,
    key: keyof ToneEdit,
    value: number
  ): void {
    const target = host.editTarget;
    if (!target) return;
    const next: ToneEdit = { ...this.tone, [key]: value };
    this.tone = next;
    this.toneForPath = target;
    setPhotoTone(target, isToneZero(next) ? null : next);
    host.requestUpdate();
  }
}

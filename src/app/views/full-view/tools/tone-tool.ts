/**
 * Tone tool: exposure / contrast / saturation / blacks / shadows /
 * highlights / whites sliders. Owns the local `tone` mirror and
 * routes per-slider edits into the edit store.
 *
 * Unlike the crop tool, tone has no interactive canvas overlay —
 * the canvas reads `ToneEdit` from the edit store via its own
 * `subscribePhotoEdits` subscription. So `applyToCanvas` is a
 * no-op; we just push through the store.
 */
import { html, type TemplateResult } from "lit";
import {
  defaultTone,
  isToneZero,
  type ToneEdit,
} from "@domain/edits";
import {
  getPhotoEdit,
  setPhotoTone,
} from "@services/edits/edits-store";
import "../pf-basic-card";
import { EditTool, type ToolHost } from "./edit-tool";

export class ToneTool extends EditTool {
  readonly id = "tone";

  tone: ToneEdit = defaultTone();
  /** Path the `tone` mirror was hydrated from. */
  private toneForPath: string | null = null;

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

  reset(host: ToolHost): void {
    const target = host.editTarget;
    if (!target) return;
    if (isToneZero(this.tone)) return;
    this.tone = defaultTone();
    this.toneForPath = target;
    setPhotoTone(target, null);
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
        @tone-reset=${() => this.reset(host)}
      ></pf-basic-card>
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

/**
 * Curve tool: per-photo tone curve (RGB + R/G/B + Luma). Mirrors the
 * `ToneTool` pattern: keeps a local copy of the curve hydrated from
 * the edits store, routes changes back through `setPhotoCurve`, and
 * renders a `pf-curve-card`. Like tone, the canvas reads the curve
 * from the edits store via its own subscription so `applyToCanvas`
 * is a no-op.
 */
import { html, type TemplateResult } from "lit";
import {
  defaultCurve,
  isCurveZero,
  type CurveEdit,
} from "@domain/edits";
import { getPhotoEdit, setPhotoCurve } from "@services/edits/edits-store";
import "@ui/cards/pf-curve-card";
import { EditTool, type ToolHost } from "./edit-tool";

export class CurveTool extends EditTool {
  readonly id = "curve";

  curve: CurveEdit = defaultCurve();
  private curveForPath: string | null = null;

  syncFromStore(target: string | null): void {
    if (target == null) {
      if (this.curveForPath !== null) {
        this.curve = defaultCurve();
        this.curveForPath = null;
      }
      return;
    }
    if (target === this.curveForPath) return;
    const persisted = getPhotoEdit(target)?.curve ?? null;
    this.curve = persisted ?? defaultCurve();
    this.curveForPath = target;
  }

  invalidateMirror(): void {
    this.curveForPath = null;
  }

  hasEdits(_target: string): boolean {
    return !isCurveZero(this.curve);
  }

  serializeEdit(target: string): unknown | null {
    const curve = getPhotoEdit(target)?.curve ?? null;
    return curve ? structuredClone(curve) : null;
  }

  applyEdit(host: ToolHost, data: unknown): void {
    const target = host.editTarget;
    if (!target) return;
    if (data == null) {
      this.curve = defaultCurve();
      this.curveForPath = target;
      setPhotoCurve(target, null);
      host.requestUpdate();
      return;
    }
    const curve = structuredClone(data as CurveEdit);
    this.curve = curve;
    this.curveForPath = target;
    setPhotoCurve(target, isCurveZero(curve) ? null : curve);
    host.requestUpdate();
  }

  reset(host: ToolHost): void {
    const target = host.editTarget;
    if (!target) return;
    if (isCurveZero(this.curve)) return;
    this.curve = defaultCurve();
    this.curveForPath = target;
    setPhotoCurve(target, null);
    host.requestUpdate();
  }

  renderCard(host: ToolHost): TemplateResult {
    return html`
      <pf-curve-card
        .value=${this.curve}
        ?open=${this.cardOpen}
        @toggle=${(e: CustomEvent<{ open: boolean }>) => {
          this.cardOpen = e.detail.open;
          host.requestUpdate();
        }}
        @curve-change=${(e: CustomEvent<CurveEdit>) =>
          this.onCurveChange(host, e.detail)}
        @curve-reset=${() => this.reset(host)}
      ></pf-curve-card>
    `;
  }

  private onCurveChange(host: ToolHost, next: CurveEdit): void {
    const target = host.editTarget;
    if (!target) return;
    this.curve = next;
    this.curveForPath = target;
    setPhotoCurve(target, isCurveZero(next) ? null : next);
    host.requestUpdate();
  }
}

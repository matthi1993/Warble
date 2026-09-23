import { html, type TemplateResult } from "lit";
import { defaultCurve, isCurveZero, type CurveEdit } from "@domain/edits";
import { getPhotoEdit, setPhotoCurve } from "@services/edits/edits-store";
import { getPostProcess, resetPostCurve, setPostCurve } from "@services/post-process/post-process-store";
import { EditTool, type ToolHost, type ToolScope } from "../../tool";
import "./curve.ui";

export function readCurveToolValue(scope: ToolScope, path: string | null): CurveEdit {
  if (scope === "post") return getPostProcess().curve;
  return (path ? getPhotoEdit(path)?.curve : null) ?? defaultCurve();
}

export class CurveTool extends EditTool {
  readonly id = "curve";

  private value(host: ToolHost): CurveEdit {
    return readCurveToolValue(this.scope, host.editTarget);
  }

  hasEdits(target: string): boolean {
    return !isCurveZero(getPhotoEdit(target)?.curve);
  }

  serializeEdit(target: string): unknown | null {
    const value = getPhotoEdit(target)?.curve;
    return value ? structuredClone(value) : null;
  }

  applyEdit(host: ToolHost, data: unknown): void {
    if (!host.editTarget || this.scope !== "photo") return;
    const value = data == null ? null : structuredClone(data as CurveEdit);
    setPhotoCurve(host.editTarget, value && !isCurveZero(value) ? value : null);
    host.requestUpdate();
  }

  reset(host: ToolHost): void {
    if (this.scope === "post") resetPostCurve();
    else if (host.editTarget) setPhotoCurve(host.editTarget, null);
    host.requestUpdate();
  }

  renderCard(host: ToolHost): TemplateResult {
    return html`<pf-curve-card
      .title=${this.scope === "post" ? "Post Curve" : "Curve"}
      .value=${this.value(host)}
      ?open=${this.cardOpen}
      .effectDisabled=${this.effectDisabled(host)}
      @effect-toggle=${() => this.toggleEffect(host)}
      @toggle=${(event: CustomEvent<{ open: boolean }>) => {
        this.cardOpen = event.detail.open;
        host.requestUpdate();
      }}
      @curve-change=${(event: CustomEvent<CurveEdit>) => {
        if (this.scope === "post") setPostCurve(event.detail);
        else if (host.editTarget) setPhotoCurve(host.editTarget, event.detail);
        host.requestUpdate();
      }}
      @curve-reset=${() => this.reset(host)}
    ></pf-curve-card>`;
  }
}

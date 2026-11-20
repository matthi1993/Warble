import { html, type TemplateResult } from "lit";
import type { CurveTool, ToolHost } from "@warble/editing";
import type { CurveEdit } from "@warble/render";
import "./pf-curve-card";

export function renderCurveCard(tool: CurveTool, host: ToolHost): TemplateResult {
  return html`
    <pf-curve-card
      .title=${tool.scope === "post" ? "Post Curve" : "Curve"}
      .value=${tool.value(host)}
      ?open=${tool.cardOpen}
      .effectDisabled=${tool.isEffectDisabled(host)}
      @effect-toggle=${() => tool.toggleEffect(host)}
      @toggle=${(event: CustomEvent<{ open: boolean }>) => tool.setCardOpen(host, event.detail.open)}
      @curve-change=${(event: CustomEvent<CurveEdit>) => tool.change(host, event.detail)}
      @curve-reset=${() => tool.reset(host)}
    ></pf-curve-card>
  `;
}

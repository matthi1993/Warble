import { html, type TemplateResult } from "lit";
import type { AnalogTool, ToolHost } from "@warble/editing";
import type { AnalogSettings } from "@warble/render";
import "./pf-analog-card";

export function renderAnalogCard(tool: AnalogTool, host: ToolHost): TemplateResult {
  return html`
    <pf-analog-card
      .value=${tool.value(host)}
      ?open=${tool.cardOpen}
      .effectDisabled=${tool.isEffectDisabled(host)}
      ?can-revert=${tool.canRevert(host)}
      @effect-toggle=${() => tool.toggleEffect(host)}
      @toggle=${(event: CustomEvent<{ open: boolean }>) => tool.setCardOpen(host, event.detail.open)}
      @analog-change=${(event: CustomEvent<AnalogSettings>) => tool.change(host, event.detail)}
      @analog-reset=${() => tool.reset(host)}
    ></pf-analog-card>
  `;
}

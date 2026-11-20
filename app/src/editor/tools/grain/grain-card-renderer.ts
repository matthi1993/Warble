import { html, type TemplateResult } from "lit";
import type { GrainTool, ToolHost } from "@warble/editing";
import type { GrainSettings } from "@warble/render";
import "./pf-grain-card";

export function renderGrainCard(tool: GrainTool, host: ToolHost): TemplateResult {
  return html`
    <pf-grain-card
      .title=${"Grain"}
      .value=${tool.value(host)}
      ?open=${tool.cardOpen}
      .effectDisabled=${tool.isEffectDisabled(host)}
      ?can-revert=${tool.canRevert(host)}
      @effect-toggle=${() => tool.toggleEffect(host)}
      @toggle=${(event: CustomEvent<{ open: boolean }>) => tool.setCardOpen(host, event.detail.open)}
      @grain-change=${(event: CustomEvent<GrainSettings>) => tool.change(host, event.detail)}
      @grain-reset=${() => tool.reset(host)}
    ></pf-grain-card>
  `;
}

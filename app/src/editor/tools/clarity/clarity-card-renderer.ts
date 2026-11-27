import { html, type TemplateResult } from "lit";
import type { ClarityTool, ToolHost } from "@warble/editing";
import type { ClaritySettings } from "@warble/render";
import "./pf-clarity-card";

export function renderClarityCard(tool: ClarityTool, host: ToolHost): TemplateResult {
  return html`
    <pf-clarity-card
      .value=${tool.value(host)}
      ?open=${tool.cardOpen}
      .effectDisabled=${tool.isEffectDisabled(host)}
      ?can-revert=${tool.canRevert(host)}
      @effect-toggle=${() => tool.toggleEffect(host)}
      @toggle=${(event: CustomEvent<{ open: boolean }>) => tool.setCardOpen(host, event.detail.open)}
      @clarity-change=${(event: CustomEvent<ClaritySettings>) => tool.change(host, event.detail)}
      @clarity-reset=${() => tool.reset(host)}
    ></pf-clarity-card>
  `;
}

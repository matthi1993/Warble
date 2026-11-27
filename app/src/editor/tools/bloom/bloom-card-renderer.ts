import { html, type TemplateResult } from "lit";
import type { BloomTool, ToolHost } from "@warble/editing";
import type { BloomSettings } from "@warble/render";
import "./pf-bloom-card";

export function renderBloomCard(tool: BloomTool, host: ToolHost): TemplateResult {
  return html`
    <pf-bloom-card
      .value=${tool.value(host)}
      ?open=${tool.cardOpen}
      .effectDisabled=${tool.isEffectDisabled(host)}
      ?can-revert=${tool.canRevert(host)}
      @effect-toggle=${() => tool.toggleEffect(host)}
      @toggle=${(event: CustomEvent<{ open: boolean }>) => tool.setCardOpen(host, event.detail.open)}
      @bloom-change=${(event: CustomEvent<BloomSettings>) => tool.change(host, event.detail)}
      @bloom-reset=${() => tool.reset(host)}
    ></pf-bloom-card>
  `;
}

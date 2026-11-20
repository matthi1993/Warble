import { html, type TemplateResult } from "lit";
import type { SharpenTool, ToolHost } from "@warble/editing";
import type { SharpenSettings } from "@warble/render";
import "./pf-sharpen-card";

export function renderSharpenCard(tool: SharpenTool, host: ToolHost): TemplateResult {
  return html`
    <pf-sharpen-card
      .title=${tool.scope === "post" ? "Output Sharpening" : "Sharpen"}
      .value=${tool.value(host)}
      ?open=${tool.cardOpen}
      .effectDisabled=${tool.isEffectDisabled(host)}
      ?can-revert=${tool.canRevert(host)}
      @effect-toggle=${() => tool.toggleEffect(host)}
      @toggle=${(event: CustomEvent<{ open: boolean }>) => tool.setCardOpen(host, event.detail.open)}
      @sharpen-change=${(event: CustomEvent<SharpenSettings>) => tool.change(host, event.detail)}
      @sharpen-reset=${() => tool.reset(host)}
    ></pf-sharpen-card>
  `;
}

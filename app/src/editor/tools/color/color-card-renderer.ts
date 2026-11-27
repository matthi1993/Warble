import { html, type TemplateResult } from "lit";
import type { ColorTool, ToolHost } from "@warble/editing";
import type { ColorEdit } from "@warble/render";
import "./pf-color-card";

export function renderColorCard(tool: ColorTool, host: ToolHost): TemplateResult {
  return html`
    <pf-color-card
      .title=${"Color"}
      .value=${tool.value(host)}
      ?open=${tool.cardOpen}
      .effectDisabled=${tool.isEffectDisabled(host)}
      @effect-toggle=${() => tool.toggleEffect(host)}
      @toggle=${(event: CustomEvent<{ open: boolean }>) => tool.setCardOpen(host, event.detail.open)}
      @color-change=${(event: CustomEvent<ColorEdit>) => tool.change(host, event.detail)}
      @color-reset=${() => tool.reset(host)}
    ></pf-color-card>
  `;
}

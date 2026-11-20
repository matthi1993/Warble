import { html, type TemplateResult } from "lit";
import type { AspectRatioKey, CropTool, Orientation, ToolHost } from "@warble/editing";
import "./pf-crop-card";

export function renderCropCard(tool: CropTool, host: ToolHost): TemplateResult {
  return html`
    <pf-crop-card
      ?open=${tool.cardOpen}
      .effectDisabled=${tool.isEffectDisabled(host)}
      .aspect=${tool.aspect}
      .orientation=${tool.orientation}
      .rotation=${tool.rotation}
      ?horizonMode=${tool.horizonModeActive}
      ?canRevert=${tool.canRevert(host)}
      @effect-toggle=${() => tool.toggleEffect(host)}
      @toggle=${(event: CustomEvent<{ open: boolean }>) => tool.setCardOpen(host, event.detail.open)}
      @aspect-change=${(event: CustomEvent<AspectRatioKey>) => tool.setAspect(host, event.detail)}
      @orientation-change=${(event: CustomEvent<Orientation>) => tool.setOrientation(host, event.detail)}
      @rotate-90=${(event: CustomEvent<-1 | 1>) => tool.rotateQuarterTurn(host, event.detail)}
      @horizon-toggle=${() => tool.toggleHorizonMode(host)}
      @rotation-change=${(event: CustomEvent<number>) => tool.setStraighten(host, event.detail)}
      @crop-reset=${() => tool.reset(host)}
    ></pf-crop-card>
  `;
}

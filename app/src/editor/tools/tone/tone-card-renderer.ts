import { html, type TemplateResult } from "lit";
import { BASE_TONE_TOGGLE, DYNAMIC_RANGE_TOGGLE, type ToneTool, type ToolHost } from "@warble/editing";
import type { ToneEdit } from "@warble/render";
import "./pf-basic-card";
import "./pf-dynamic-range-card";

type ToneChange = CustomEvent<{ key: keyof ToneEdit; value: number }>;
type ToneKeyReset = CustomEvent<{ key: keyof ToneEdit }>;
type CardToggle = CustomEvent<{ open: boolean }>;

export function renderToneCard(tool: ToneTool, host: ToolHost): TemplateResult {
  const tone = tool.value(host);
  const setKey = (event: ToneChange) => tool.setKey(host, event.detail.key, event.detail.value);
  const resetKey = (event: ToneKeyReset) => tool.resetKey(host, event.detail.key);
  return html`
    <pf-basic-card
      .tone=${tone}
      ?open=${tool.cardOpen}
      .effectDisabled=${tool.isEffectDisabled(host, BASE_TONE_TOGGLE)}
      @effect-toggle=${() => tool.toggleEffect(host, BASE_TONE_TOGGLE)}
      @toggle=${(event: CardToggle) => tool.setCardOpen(host, event.detail.open)}
      @tone-change=${setKey}
      @tone-reset-key=${resetKey}
      @tone-reset=${() => tool.resetBaseTone(host)}
    ></pf-basic-card>
    <pf-dynamic-range-card
      .tone=${tone}
      ?open=${tool.dynamicRangeCardOpen}
      .effectDisabled=${tool.isEffectDisabled(host, DYNAMIC_RANGE_TOGGLE)}
      @effect-toggle=${() => tool.toggleEffect(host, DYNAMIC_RANGE_TOGGLE)}
      @toggle=${(event: CardToggle) => tool.setDynamicRangeCardOpen(host, event.detail.open)}
      @tone-change=${setKey}
      @tone-reset-key=${resetKey}
      @tone-reset=${() => tool.resetDynamicRange(host)}
    ></pf-dynamic-range-card>
  `;
}

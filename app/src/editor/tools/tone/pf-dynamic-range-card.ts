import { customElement } from "lit/decorators.js";
import { DYNAMIC_RANGE_KEYS, isDynamicRangeZero, type ToneEdit } from "@warble/render";
import { ToneSectionCard } from "./tone-section-card";

@customElement("pf-dynamic-range-card")
export class PfDynamicRangeCard extends ToneSectionCard {
  protected readonly heading = "Dynamic Range";
  protected readonly revertLabel = "Revert dynamic range";
  protected readonly toneKeys = DYNAMIC_RANGE_KEYS;

  protected isNeutral(tone: ToneEdit): boolean {
    return isDynamicRangeZero(tone);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-dynamic-range-card": PfDynamicRangeCard;
  }
}

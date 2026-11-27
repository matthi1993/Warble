import { customElement } from "lit/decorators.js";
import { BASE_TONE_KEYS, isBaseToneZero, type ToneEdit } from "@warble/render";
import { ToneSectionCard } from "./tone-section-card";

@customElement("pf-basic-card")
export class PfBasicCard extends ToneSectionCard {
  protected readonly heading = "Base Edit";
  protected readonly revertLabel = "Revert base edits";
  protected readonly toneKeys = BASE_TONE_KEYS;

  protected isNeutral(tone: ToneEdit): boolean {
    return isBaseToneZero(tone);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-basic-card": PfBasicCard;
  }
}

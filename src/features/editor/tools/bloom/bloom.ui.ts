import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { defaultBloom, type BloomSettings } from "@domain/edits";
import "@ui/cards/pf-card";
import "@ui/controls/pf-slider";
import "@ui/icons/pf-icon";

@customElement("pf-bloom-card")
export class PfBloomCard extends LitElement {
  static styles = css`
    :host { display: block; }
    .card-revert { background: transparent; color: var(--pf-text-muted); border: none; border-left: 1px solid var(--pf-border); padding: 0 10px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
    .card-revert:hover { background: var(--pf-surface-hover); color: var(--pf-text); }
    .card-revert:disabled { opacity: .35; cursor: default; }
    .body { padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 10px; }
    .row { display: grid; grid-template-columns: 1fr auto; column-gap: 8px; row-gap: 2px; align-items: center; }
    .label { font-size: var(--pf-text-xs); color: var(--pf-text); }
    .value { font-size: var(--pf-text-xs); color: var(--pf-text-muted); font-variant-numeric: tabular-nums; min-width: 3ch; text-align: right; }
    pf-slider { grid-column: 1 / span 2; width: 100%; }
  `;

  @property({ attribute: false }) value: BloomSettings = defaultBloom();
  @property({ type: Boolean }) open = false;
  @property({ type: Boolean }) effectDisabled = false;
  @property() title = "Bloom";
  @property({ type: Boolean, attribute: "can-revert" }) canRevert: boolean | null = null;

  private emit(key: keyof BloomSettings, event: CustomEvent<number>): void {
    event.stopPropagation();
    this.dispatchEvent(new CustomEvent<BloomSettings>("bloom-change", {
      detail: { ...this.value, [key]: event.detail }, bubbles: true, composed: true,
    }));
  }

  render() {
    const defaults = defaultBloom();
    const controls: Array<[keyof BloomSettings, string, number, number, number]> = [
      ["strength", "Bloom", 0, 100, 1],
      ["threshold", "Threshold", 0, 100, 1],
      ["radius", "Radius", 0, 100, 1],
      ["softness", "Softness", 0, 100, 1],
      ["spread", "Spread", 0, 100, 1],
    ];
    const canRevert = this.canRevert ?? controls.some(([key]) => this.value[key] !== defaults[key]);
    return html`<pf-card .effectDisabled=${this.effectDisabled} .title=${this.title} ?open=${this.open} @toggle=${(e: CustomEvent<{ open: boolean }>) => { this.dispatchEvent(new CustomEvent("toggle", { detail: e.detail, bubbles: true, composed: true })); }}>
      <button slot="revert" type="button" class="card-revert" title="Reset bloom" aria-label="Reset bloom" ?disabled=${!canRevert} @click=${() => this.dispatchEvent(new CustomEvent("bloom-reset", { bubbles: true, composed: true }))}><pf-icon name="rotate-ccw"></pf-icon></button>
      <div class="body">${controls.map(([key, label, min, max, step]) => html`
        <div class="row"><span class="label">${label}</span><span class="value">${this.value[key]}</span>
          <pf-slider min=${min} max=${max} step=${step} .value=${this.value[key]} label=${label} fill-from=${min} @change=${(e: CustomEvent<number>) => this.emit(key, e)}></pf-slider>
        </div>`)}
      </div>
    </pf-card>`;
  }
}

declare global { interface HTMLElementTagNameMap { "pf-bloom-card": PfBloomCard; } }

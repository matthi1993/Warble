import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { defaultAnalog, type AnalogSettings } from "@domain/edits";
import "@ui/cards/pf-card";
import "@ui/controls/pf-slider";
import "@ui/icons/pf-icon";

const CONTROLS: ReadonlyArray<{ key: keyof AnalogSettings; label: string; hint: string }> = [
  { key: "vignette", label: "Vignetting", hint: "Darken the corners with a smooth lens falloff." },
  { key: "halation", label: "Halation", hint: "Diffuse bright highlights into a warm film-like halo." },
  { key: "chromaticAberration", label: "Lateral chromatic aberration", hint: "Separate color channels progressively toward the edges." },
];

@customElement("pf-analog-card")
export class PfAnalogCard extends LitElement {
  static styles = css`
    :host { display: block; }
    .card-revert {
      background: transparent; color: var(--pf-text-muted); border: none;
      border-left: 1px solid var(--pf-border); padding: 0 10px; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .card-revert:hover { background: var(--pf-surface-hover); color: var(--pf-text); }
    .card-revert:disabled { opacity: .35; cursor: default; }
    .body { padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 10px; }
    .row { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; align-items: center; }
    .label { font-size: var(--pf-text-xs); color: var(--pf-text); }
    .value { font-size: var(--pf-text-xs); color: var(--pf-text-muted); font-variant-numeric: tabular-nums; text-align: right; }
    pf-slider { grid-column: 1 / span 2; width: 100%; }
  `;

  @property({ attribute: false }) value: AnalogSettings = defaultAnalog();
  @property({ type: Boolean }) open = false;
  @property({ type: Boolean }) effectDisabled = false;
  @property({ type: Boolean, attribute: "can-revert" }) canRevert = false;

  private emit(key: keyof AnalogSettings, event: CustomEvent<number>): void {
    event.stopPropagation();
    this.dispatchEvent(new CustomEvent<AnalogSettings>("analog-change", {
      detail: { ...this.value, [key]: event.detail }, bubbles: true, composed: true,
    }));
  }

  private onToggle(event: CustomEvent<{ open: boolean }>): void {
    event.stopPropagation();
    this.dispatchEvent(new CustomEvent("toggle", { detail: event.detail, bubbles: true, composed: true }));
  }

  render() {
    const defaults = defaultAnalog();
    return html`<pf-card title="Analog Effects" .effectDisabled=${this.effectDisabled} ?open=${this.open} @toggle=${this.onToggle}>
      <button slot="revert" type="button" class="card-revert" title="Reset analog effects"
        aria-label="Reset analog effects" ?disabled=${!this.canRevert}
        @click=${() => this.dispatchEvent(new CustomEvent("analog-reset", { bubbles: true, composed: true }))}>
        <pf-icon name="rotate-ccw"></pf-icon>
      </button>
      <div class="body">${CONTROLS.map(({ key, label, hint }) => html`
        <div class="row" title=${hint}>
          <span class="label">${label}</span><span class="value">${this.value[key]}</span>
          <pf-slider min="0" max="100" step="1" .value=${this.value[key]} label=${label}
            fill-from=${defaults[key]} @change=${(event: CustomEvent<number>) => this.emit(key, event)}></pf-slider>
        </div>`)}
      </div>
    </pf-card>`;
  }
}

declare global { interface HTMLElementTagNameMap { "pf-analog-card": PfAnalogCard; } }

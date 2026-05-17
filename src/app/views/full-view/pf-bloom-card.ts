/**
 * `pf-bloom-card` — per-photo highlight bloom with strength, size,
 * and threshold sliders. State lives in the effects store keyed by
 * the active photo path; the card subscribes for live updates so
 * the slider reflects copy/paste from `cmd+v`.
 *
 * The shader picks up the same three values and approximates a
 * single-pass bloom: it samples a wide ring around each pixel,
 * keeps only the luminance above the threshold, and adds the
 * weighted sum back to the centre — giving bright highlights a
 * soft halo without affecting midtones.
 */
import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import "@ui/cards/pf-card";
import "@ui/controls/pf-slider";
import "@ui/icons/pf-icon";
import {
  defaultBloom,
  getPhotoBloom,
  setPhotoBloom,
  subscribePhotoEffects,
  type BloomSettings,
} from "@services/effects/effects-store";

@customElement("pf-bloom-card")
export class PfBloomCard extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    .row {
      display: grid;
      grid-template-columns: 1fr auto;
      column-gap: 8px;
      row-gap: 2px;
      align-items: center;
      margin-bottom: 6px;
    }
    .row .label {
      font-size: var(--pf-text-xs);
      color: var(--pf-text);
    }
    .row .value {
      font-size: var(--pf-text-xs);
      color: var(--pf-text-muted);
      font-variant-numeric: tabular-nums;
      min-width: 3ch;
      text-align: right;
      cursor: pointer;
    }
    .row .value:hover {
      color: var(--pf-text);
    }
    pf-slider {
      grid-column: 1 / span 2;
      width: 100%;
    }
    .card-revert {
      background: transparent;
      border: none;
      color: var(--pf-text-muted);
      padding: 2px 4px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
    }
    .card-revert:not([disabled]):hover {
      color: var(--pf-text);
    }
    .card-revert[disabled] {
      opacity: 0.4;
      cursor: default;
    }
  `;

  /** Photo path the card is editing. The shell passes the active
   *  edit target; nothing renders until a path is bound. */
  @property({ attribute: false })
  target: string | null = null;

  /** Open-state forwarded by the shell so the existing
   *  active-tool-focus logic keeps working. */
  @property({ type: Boolean })
  open = true;

  /** Local mirror — patched from the store on every notify so live
   *  paste / external mutation refresh the sliders. */
  @state()
  private bloom: BloomSettings = defaultBloom();

  private unsub: (() => void) | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    this.refreshFromStore();
    this.unsub = subscribePhotoEffects((path) => {
      if (path === this.target) this.refreshFromStore();
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsub?.();
    this.unsub = null;
  }

  updated(changed: Map<string, unknown>): void {
    if (changed.has("target")) this.refreshFromStore();
  }

  private refreshFromStore(): void {
    const stored = getPhotoBloom(this.target);
    this.bloom = stored ? { ...defaultBloom(), ...stored } : defaultBloom();
  }

  private commit(patch: Partial<BloomSettings>): void {
    if (!this.target) return;
    const next: BloomSettings = { ...this.bloom, ...patch };
    this.bloom = next;
    setPhotoBloom(this.target, next);
  }

  private onStrength = (e: CustomEvent<number>) =>
    this.commit({ strength: e.detail });
  private onSize = (e: CustomEvent<number>) =>
    this.commit({ size: e.detail });
  private onThreshold = (e: CustomEvent<number>) =>
    this.commit({ threshold: e.detail });

  private resetField = (field: keyof BloomSettings) => () => {
    const d = defaultBloom();
    this.commit({ [field]: d[field] } as Partial<BloomSettings>);
  };

  private onRevert = () => {
    if (!this.target) return;
    setPhotoBloom(this.target, null);
  };

  private onToggle = (e: CustomEvent<{ open: boolean }>) => {
    this.dispatchEvent(
      new CustomEvent("toggle", { detail: e.detail, bubbles: true, composed: true })
    );
  };

  private hasEdits(): boolean {
    return this.bloom.strength > 0;
  }

  private revertButton() {
    return html`
      <button
        slot="revert"
        type="button"
        class="card-revert"
        title="Reset bloom"
        aria-label="Reset bloom"
        ?disabled=${!this.hasEdits()}
        @click=${this.onRevert}
      >
        <pf-icon name="rotate-ccw"></pf-icon>
      </button>
    `;
  }

  render() {
    const b = this.bloom;
    return html`
      <pf-card .title=${"Bloom"} ?open=${this.open} @toggle=${this.onToggle}>
        ${this.revertButton()}
        <div class="row">
          <span class="label">Strength</span>
          <span
            class="value"
            title="Double-click to reset (0 = no bloom)"
            @dblclick=${this.resetField("strength")}
            >${b.strength}</span
          >
          <pf-slider
            min="0"
            max="100"
            step="1"
            .value=${b.strength}
            label="Bloom strength (master intensity, 0 disables)"
            fill-from="0"
            @change=${this.onStrength}
          ></pf-slider>
        </div>
        <div class="row">
          <span class="label">Size</span>
          <span
            class="value"
            title="Double-click to reset"
            @dblclick=${this.resetField("size")}
            >${b.size}</span
          >
          <pf-slider
            min="1"
            max="200"
            step="1"
            .value=${b.size}
            label="Bloom radius in screen pixels"
            fill-from="1"
            @change=${this.onSize}
          ></pf-slider>
        </div>
        <div class="row">
          <span class="label">Threshold</span>
          <span
            class="value"
            title="Double-click to reset"
            @dblclick=${this.resetField("threshold")}
            >${b.threshold}</span
          >
          <pf-slider
            min="0"
            max="100"
            step="1"
            .value=${b.threshold}
            label="Luminance threshold — only pixels brighter than this glow"
            fill-from="0"
            @change=${this.onThreshold}
          ></pf-slider>
        </div>
      </pf-card>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-bloom-card": PfBloomCard;
  }
}

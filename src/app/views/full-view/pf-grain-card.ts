/**
 * `pf-grain-card` — global film-scan controls (Amount, Size) plus a
 * "regenerate" button that bumps the seed so the pattern reshuffles.
 * Settings are post-process and global: the same grain pattern is
 * stamped onto every photo at render time by `TonePipeline`. (The
 * seed is mixed with a per-photo hash inside the canvas so navigating
 * between photos still produces fresh-looking grain.)
 *
 * Why global instead of per-photo? Grain is a *look*, not an *edit* —
 * you pick a stock and then audition photos through it. Per-photo
 * grain would balloon the edit-store JSON and confuse users into
 * thinking it's a destructive adjustment.
 */
import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import "@ui/cards/pf-card";
import "@ui/controls/pf-slider";
import "@ui/icons/pf-icon";
import {
  defaultGrain,
  getPostProcess,
  resetGrain,
  setGrain,
  subscribePostProcess,
  type GrainSettings,
} from "@services/post-process/post-process-store";

@customElement("pf-grain-card")
export class PfGrainCard extends LitElement {
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
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 4px;
      margin-top: 4px;
    }
    .card-revert,
    .regen-btn {
      background: transparent;
      border: none;
      color: var(--pf-text-muted);
      padding: 2px 4px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
    }
    .card-revert:not([disabled]):hover,
    .regen-btn:hover {
      color: var(--pf-text);
    }
    .card-revert[disabled] {
      opacity: 0.4;
      cursor: default;
    }
  `;

  /** Local mirror of the post-process grain so we re-render when
   * another card (or shortcut) mutates it via the store. */
  @state()
  private grain: GrainSettings = getPostProcess().grain;

  /** Disclosure state for the wrapping `pf-card`. Kept local so
   *  closing the card persists for the lifetime of the view, the
   *  same way the edit-panel tool cards work. */
  @state()
  private open = true;

  private unsub: (() => void) | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    this.unsub = subscribePostProcess((next) => {
      this.grain = next.grain;
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsub?.();
    this.unsub = null;
  }

  private onSize = (e: CustomEvent<number>) => {
    setGrain({ size: e.detail });
  };

  private onAmount = (e: CustomEvent<number>) => {
    setGrain({ amount: e.detail });
  };

  private resetField = (field: keyof GrainSettings) => () => {
    const d = defaultGrain();
    setGrain({ [field]: d[field] } as Partial<GrainSettings>);
  };

  private onRegenerate = () => {
    // Bumping the seed shuffles the hash-noise without touching the
    // other dials — useful for finding a pattern that doesn't fall
    // on top of the subject's eyes.
    setGrain({ seed: Math.floor(Math.random() * 1e6) + 1 });
  };

  private onRevert = () => {
    resetGrain();
  };

  private hasEdits(): boolean {
    const d = defaultGrain();
    return this.grain.amount !== d.amount || this.grain.size !== d.size;
  }

  private revertButton() {
    return html`
      <button
        slot="revert"
        type="button"
        class="card-revert"
        title="Reset grain"
        aria-label="Reset grain"
        ?disabled=${!this.hasEdits()}
        @click=${this.onRevert}
      >
        <pf-icon name="rotate-ccw"></pf-icon>
      </button>
    `;
  }

  render() {
    const g = this.grain;
    // Size is float so we trim to one decimal so the chip stays
    // compact (3 -> "3", 0.5 -> "0.5"). Amount / dust / scratches
    // are integers.
    const sizeLabel = Number.isInteger(g.size)
      ? String(g.size)
      : g.size.toFixed(1);
    return html`
      <pf-card
        .title=${"Grain"}
        ?open=${this.open}
        @toggle=${(e: CustomEvent<{ open: boolean }>) =>
          (this.open = e.detail.open)}
      >
        ${this.revertButton()}
        <div class="row">
          <span class="label">Amount</span>
          <span
            class="value"
            title="Double-click to reset (0 = no grain)"
            @dblclick=${this.resetField("amount")}
            >${g.amount}</span
          >
          <pf-slider
            min="0"
            max="100"
            step="1"
            .value=${g.amount}
            label="Grain amount (master intensity, 0 disables)"
            fill-from="0"
            @change=${this.onAmount}
          ></pf-slider>
        </div>
        <div class="row">
          <span class="label">Size</span>
          <span
            class="value"
            title="Double-click to reset"
            @dblclick=${this.resetField("size")}
            >${sizeLabel}</span
          >
          <pf-slider
            min="0.5"
            max="5"
            step="0.1"
            .value=${g.size}
            label="Grain size"
            fill-from="0.5"
            @change=${this.onSize}
          ></pf-slider>
        </div>
        <div class="actions">
          <button
            type="button"
            class="regen-btn"
            title="Regenerate pattern"
            aria-label="Regenerate pattern"
            @click=${this.onRegenerate}
          >
            <pf-icon name="refresh"></pf-icon>
          </button>
        </div>
      </pf-card>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-grain-card": PfGrainCard;
  }
}

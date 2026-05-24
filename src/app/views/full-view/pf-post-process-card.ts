/**
 * `pf-post-process-card` — container that stacks the post-process
 * tools (Color + Post Curve) shown in the right-side panel's
 * "Post" tab. Each individual tool is its own self-contained card
 * with its own revert button; this element is just a flex column.
 *
 * Settings are GLOBAL: they live in `post-process-store` and apply
 * to every photo the canvas renders. Editing them inside the
 * full-view panel means you audition the look on whichever photo
 * happens to be open, not "edit the look of photo X".
 */
import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import "@ui/cards/pf-color-card";
import "@ui/cards/pf-curve-card";
import {
  getPostProcess,
  setPostColor,
  resetPostColor,
  setPostCurve,
  resetPostCurve,
  setPostProcessEnabled,
  subscribePostProcess,
  type PostProcessSettings,
} from "@services/post-process/post-process-store";
import {
  defaultColor,
  defaultCurve,
  type ColorEdit,
  type CurveEdit,
} from "@domain/edits";

@customElement("pf-post-process-card")
export class PfPostProcessCard extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--pf-space-2);
    }
    .enable-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 8px;
      background: var(--pf-surface);
      border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-sm, 4px);
    }
    .enable-row .label {
      font-size: var(--pf-text-sm);
      color: var(--pf-text);
      font-weight: 500;
    }
    .toggle {
      position: relative;
      width: 36px;
      height: 20px;
      border-radius: 999px;
      background: var(--pf-border);
      border: none;
      cursor: pointer;
      padding: 0;
      transition: background 120ms ease;
    }
    .toggle[aria-pressed="true"] {
      background: var(--pf-accent, #4a90e2);
    }
    .toggle::after {
      content: "";
      position: absolute;
      top: 2px;
      left: 2px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: white;
      transition: transform 120ms ease;
    }
    .toggle[aria-pressed="true"]::after {
      transform: translateX(16px);
    }
    .dim {
      opacity: 0.5;
      pointer-events: none;
    }
    .stack {
      display: flex;
      flex-direction: column;
      gap: var(--pf-space-2);
    }
  `;

  @state()
  private settings: PostProcessSettings = getPostProcess();

  /** Disclosure state for the Post Curve card. Local to the view
   *  so the card behaves like every other collapsible in the edit
   *  panel. */
  @state()
  private curveOpen = true;

  @state()
  private colorOpen = true;

  private unsub: (() => void) | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    this.unsub = subscribePostProcess((next) => {
      this.settings = next;
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsub?.();
    this.unsub = null;
  }

  private onCurveChange = (e: CustomEvent<CurveEdit>) => {
    setPostCurve(e.detail);
  };

  private onCurveReset = () => {
    resetPostCurve();
  };

  private onColorChange = (e: CustomEvent<ColorEdit>) => {
    setPostColor(e.detail);
  };

  private onColorReset = () => {
    resetPostColor();
  };

  private onToggleEnabled = () => {
    setPostProcessEnabled(!this.settings.enabled);
  };

  render() {
    const enabled = this.settings.enabled;
    return html`
      <div class="enable-row">
        <span class="label">Post-Processing</span>
        <button
          type="button"
          class="toggle"
          role="switch"
          aria-pressed=${enabled ? "true" : "false"}
          aria-label="Toggle post-processing"
          title=${enabled
            ? "Disable post-processing"
            : "Enable post-processing"}
          @click=${this.onToggleEnabled}
        ></button>
      </div>
      <div class=${enabled ? "stack" : "stack dim"}>
        <pf-color-card
          .title=${"Color"}
          ?open=${this.colorOpen}
          .value=${this.settings.color ?? defaultColor()}
          @color-change=${this.onColorChange}
          @color-reset=${this.onColorReset}
          @toggle=${(e: CustomEvent<{ open: boolean }>) =>
            (this.colorOpen = e.detail.open)}
        ></pf-color-card>
        <pf-curve-card
          .title=${"Post Curve"}
          ?open=${this.curveOpen}
          .value=${this.settings.curve ?? defaultCurve()}
          @curve-change=${this.onCurveChange}
          @curve-reset=${this.onCurveReset}
          @toggle=${(e: CustomEvent<{ open: boolean }>) =>
            (this.curveOpen = e.detail.open)}
        ></pf-curve-card>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-post-process-card": PfPostProcessCard;
  }
}

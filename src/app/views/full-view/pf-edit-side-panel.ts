/**
 * `pf-edit-side-panel` — layout-only container for the right-side edit
 * panel. Provides scrollable body + sticky footer, pre-styled to
 * match the legacy `.edit-side-panel` rules. The host slots in the
 * cards and footer buttons.
 *
 * Reveal/hide animation, positioning, and pointer-event gating are
 * still owned by the host's CSS (see styles.ts) so the same
 * fullscreen vs. windowed behaviour is preserved.
 */
import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";

@customElement("pf-edit-side-panel")
export class PfEditSidePanel extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-sizing: border-box;
      min-height: 0;
      width: 100%;
    }
    .body {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      display: grid;
      grid-auto-rows: max-content;
      align-content: start;
      gap: var(--pf-space-2);
      padding: var(--pf-space-2);
    }
    .footer {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--pf-space-2);
      padding: var(--pf-space-2);
      border-top: 1px solid var(--pf-border);
      background: var(--pf-surface-2);
    }
    .footer[hidden] {
      display: none;
    }
  `;

  @state() private hasFooter = false;

  private onFooterSlotChange(event: Event): void {
    this.hasFooter = (event.target as HTMLSlotElement).assignedElements().length > 0;
  }

  render() {
    return html`
      <div class="body">
        <slot></slot>
      </div>
      <div class="footer" ?hidden=${!this.hasFooter}>
        <slot name="footer" @slotchange=${this.onFooterSlotChange}></slot>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-edit-side-panel": PfEditSidePanel;
  }
}

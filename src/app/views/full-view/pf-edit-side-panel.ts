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
import { customElement } from "lit/decorators.js";

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
      height: 100%;
    }
    .body {
      flex: 1 1 auto;
      /* min-height: 0 lets this flex item shrink below its content
         height so overflow-y can actually scroll. Without it, the
         cards push the body taller than the panel and visually
         collide with the footer / each other. */
      min-height: 0;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: var(--pf-space-2);
      padding: var(--pf-space-2);
    }
    /* Slotted cards keep their natural (open) height — no flex-shrink —
       so opening a card simply makes the body scroll instead of
       squashing siblings. */
    ::slotted(*) {
      flex: 0 0 auto;
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
    /* Hide the footer chrome entirely when nothing is slotted into
       it. Used by non-edit tabs (info, post-process). */
    .footer:not(:has(*)) {
      display: none;
    }
  `;

  render() {
    return html`
      <div class="body">
        <slot></slot>
      </div>
      <div class="footer">
        <slot name="footer"></slot>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-edit-side-panel": PfEditSidePanel;
  }
}

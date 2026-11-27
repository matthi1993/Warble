import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { app } from "@app/composition/app";
import { busyOverlayStyles } from "./pf-busy-overlay.styles";

@customElement("pf-busy-overlay")
export class PfBusyOverlay extends LitElement {
  static styles = busyOverlayStyles;

  @state() private label: string | null = null;
  private stopListening: (() => void) | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    this.stopListening = app.busy.subscribe((label) => (this.label = label));
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stopListening?.();
    this.stopListening = null;
  }

  render() {
    if (!this.label) return nothing;
    return html`
      <div class="app-busy-overlay" aria-hidden="false">
        <div class="app-busy-status" role="status" aria-live="polite">
          <span class="app-busy-spinner" aria-hidden="true"></span>
          <span>${this.label}</span>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-busy-overlay": PfBusyOverlay;
  }
}

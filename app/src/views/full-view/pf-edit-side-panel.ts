import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { editSidePanelStyles } from "./pf-edit-side-panel.styles";

@customElement("pf-edit-side-panel")
export class PfEditSidePanel extends LitElement {
  static styles = editSidePanelStyles;

  @state()
  private hasFooter = false;

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

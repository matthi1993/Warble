import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { buildExifSections, type ExifMetadata } from "@warble/library";
import "@ui/cards/pf-card";
import "@ui/cards/pf-info-row";
import { infoCardStyles } from "./pf-info-card.styles";

@customElement("pf-info-card")
export class PfInfoCard extends LitElement {
  static styles = infoCardStyles;

  /** `null` while loading, `{}` when no fields are available. */
  @property({ attribute: false })
  exif: ExifMetadata | null = null;

  @property({ type: Boolean })
  open = false;

  private onToggle(event: CustomEvent<{ open: boolean }>): void {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent<{ open: boolean }>("toggle", { detail: event.detail, bubbles: true, composed: true }),
    );
  }

  private renderContent() {
    if (this.exif === null) return html`<div class="exif-empty">Reading EXIF…</div>`;
    const sections = buildExifSections(this.exif);
    if (sections.length === 0) return html`<div class="exif-empty">No EXIF metadata.</div>`;
    return sections.map(
      (section) => html`
        <div class="exif-section">${section.title}</div>
        <dl class="exif-list">
          ${section.rows.map((row) => html`<pf-info-row .label=${row.label} .value=${row.value}></pf-info-row>`)}
        </dl>
      `,
    );
  }

  render() {
    return html`
      <pf-card .title=${"Info"} ?open=${this.open} @toggle=${this.onToggle}>${this.renderContent()}</pf-card>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-info-card": PfInfoCard;
  }
}

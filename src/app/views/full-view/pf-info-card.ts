/**
 * `pf-info-card` — EXIF metadata disclosure card. Pure presentational:
 * receives a metadata object (or `null` while loading), builds
 * sections via the domain helper, and renders them as info rows.
 */
import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { buildExifSections, type ExifMetadata } from "@domain/exif";
import "@ui/cards/pf-card";
import "@ui/cards/pf-info-row";

@customElement("pf-info-card")
export class PfInfoCard extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    .exif-list {
      display: grid;
      grid-template-columns: 110px 1fr;
      column-gap: 10px;
      row-gap: 4px;
      margin: 0;
      padding: 0;
    }
    .exif-section {
      font-size: var(--pf-text-xs);
      font-weight: 600;
      color: var(--pf-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin: 10px 0 4px;
    }
    .exif-section:first-child {
      margin-top: 0;
    }
    .exif-empty {
      font-size: var(--pf-text-xs);
      color: var(--pf-text-muted);
      padding: 4px 0;
    }
  `;

  /** `null` = loading; `{}` = no fields available. */
  @property({ attribute: false })
  exif: ExifMetadata | null = null;

  @property({ type: Boolean })
  open = false;

  private onToggle = (e: CustomEvent<{ open: boolean }>) => {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent<{ open: boolean }>("toggle", {
        detail: e.detail,
        bubbles: true,
        composed: true,
      })
    );
  };

  render() {
    const loading = this.exif === null;
    const sections = this.exif ? buildExifSections(this.exif) : [];
    return html`
      <pf-card .title=${"Info"} ?open=${this.open} @toggle=${this.onToggle}>
        ${loading
          ? html`<div class="exif-empty">Reading EXIF…</div>`
          : sections.length === 0
            ? html`<div class="exif-empty">No EXIF metadata.</div>`
            : sections.map(
                (section) => html`
                  <div class="exif-section">${section.title}</div>
                  <dl class="exif-list">
                    ${section.rows.map(
                      (r) => html`
                        <pf-info-row
                          .label=${r.label}
                          .value=${r.value}
                        ></pf-info-row>
                      `
                    )}
                  </dl>
                `
              )}
      </pf-card>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-info-card": PfInfoCard;
  }
}

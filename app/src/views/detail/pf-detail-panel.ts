import { LitElement, html, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { COLOR_LABELS, LABEL_COLORS, LABEL_DISPLAY_NAMES, type Photo } from "@warble/library";
import { VideoSources } from "@warble/media";
import { app } from "@app/composition/app";
import { currentSelection } from "@app/views/full-view/variant-selector";
import "@ui/controls/pf-icon-button";
import "@viewer/pf-image-canvas";
import "@viewer/pf-video-view";
import { DetailPanelController } from "./detail-panel-controller";
import { detailPanelStyles } from "./pf-detail-panel.styles";
import { SelectionRatingController } from "./selection-rating-controller";

@customElement("pf-detail-panel")
export class PfDetailPanel extends LitElement {
  static styles = detailPanelStyles;

  @property({ attribute: false })
  photo: Photo | null = null;

  @property({ attribute: false })
  selectionPaths: readonly string[] = [];

  @property({ type: Boolean, attribute: "fullviewopen", reflect: true })
  fullViewOpen = false;

  @property({ type: Boolean, attribute: "windowfullscreen", reflect: true })
  windowFullscreen = false;

  private readonly panel = new DetailPanelController(this, {
    exif: app.library.exif,
    variants: app.library.variants,
    currentSelection,
  });
  private readonly rating = new SelectionRatingController(this, app.library.ratings);

  connectedCallback(): void {
    super.connectedCallback();
    this.panel.connect();
    this.rating.connect();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.panel.disconnect();
    this.rating.disconnect();
  }

  protected updated(changed: PropertyValues<this>): void {
    if (changed.has("photo")) this.panel.photoChanged(changed.get("photo"));
  }

  refreshMetadata(): void {
    this.panel.refreshMetadata();
  }

  toggleVideoPlayback(): boolean {
    return this.renderRoot.querySelector("pf-video-view")?.togglePlayback() ?? false;
  }

  private announce(type: "photo-open" | "toggle-window-fullscreen", detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  private openFullView(): void {
    if (!this.photo) return;
    this.announce("photo-open", { path: this.photo.path, filename: this.photo.filename });
  }

  private renderEmpty(): TemplateResult {
    return html`
      <div class="image-wrap">
        <pf-image-canvas .path=${null} fit="contain" background="transparent"></pf-image-canvas>
      </div>
      <div class="meta">
        <div class="filename" style="color: var(--pf-text-muted); font-weight: 400;">No photo selected</div>
      </div>
    `;
  }

  private renderPreview(path: string): TemplateResult {
    return html`<div class="image-wrap">
      ${VideoSources.isVideo(path)
        ? html`<pf-video-view .path=${path}></pf-video-view>`
        : html`<pf-image-canvas .path=${path} fit="contain" background="transparent"></pf-image-canvas>`}
      ${this.panel.offersWindowControls
        ? html`<pf-icon-button
              class="expand-btn"
              icon="expand"
              label="Open full view"
              @click=${this.openFullView}
            ></pf-icon-button>
            <pf-icon-button
              class="fullscreen-btn"
              icon=${this.windowFullscreen ? "minimize" : "maximize"}
              label=${this.windowFullscreen ? "Exit fullscreen (F)" : "Enter fullscreen (F)"}
              @click=${() => this.announce("toggle-window-fullscreen")}
            ></pf-icon-button>`
        : null}
    </div>`;
  }

  private renderRating(): TemplateResult {
    const { rating } = this;
    const { targets, commonRating, commonLabel } = rating;
    return html`<div class="info-section">
      ${targets.length > 1 ? html`<h3>${targets.length} photos selected</h3>` : null}
      <div class="info-row"><dt>Rating</dt><dd class="rating-controls" role="group" aria-label="Photo rating">
        ${[1, 2, 3, 4, 5].map((star) => html`<button
          type="button"
          class=${commonRating !== null && star <= commonRating ? "active" : ""}
          aria-label=${`${star} stars`}
          @click=${() => rating.toggleStars(star)}
        >★</button>`)}
      </dd></div>
      <div class="info-row"><dt>Labels</dt><dd class="label-controls" role="group" aria-label="Photo label">
        ${COLOR_LABELS.map((label) => html`<button
          type="button"
          style=${`background: ${LABEL_COLORS[label]}`}
          aria-label=${LABEL_DISPLAY_NAMES[label]}
          aria-pressed=${commonLabel === label}
          @click=${() => rating.toggleLabel(label)}
        ></button>`)}
      </dd></div>
    </div>`;
  }

  render() {
    const photo = this.photo;
    if (!photo) return this.renderEmpty();
    const { exif, exifSections } = this.panel;
    return html`
      ${this.renderPreview(this.panel.currentPath(photo))}
      <div class="meta">
        <div class="filename">${photo.filename}</div>
        <div class="photo-facts">
          ${photo.extensions?.map((extension) => html`<span>${extension.toUpperCase()}</span>`)}
          ${exif?.pixelWidth && exif?.pixelHeight ? html`<span>${exif.pixelWidth} × ${exif.pixelHeight}</span>` : null}
          ${exif?.iso ? html`<span>ISO ${exif.iso}</span>` : null}
        </div>
        ${this.renderRating()}
        ${exifSections.map((section) => html`<section class="info-section">
          <h3>${section.title}</h3>
          <dl>${section.rows.map((row) => html`<div class="info-row"><dt>${row.label}</dt><dd>${row.value}</dd></div>`)}</dl>
        </section>`)}
        <div class="info-section">
          <h3>File path</h3>
          <div class="path">${photo.path}</div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-detail-panel": PfDetailPanel;
  }
}

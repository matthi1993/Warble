import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Photo } from "@domain/photo";
import { fileForSelection } from "@domain/photo";
import { buildExifSections, type ExifMetadata } from "@domain/exif";
import { COLOR_LABELS, LABEL_COLORS, LABEL_DISPLAY_NAMES } from "@domain/rating";
import { fetchExif } from "@services/exif/exif-service";
import { getPhotoRating, setPhotoLabel, setPhotoStars, subscribePhotoRatings } from "@services/rating/rating-store";
import {
  subscribeVariantOverrides,
} from "@services/library/variant-store";
import { currentSelection } from "./views/full-view/variant-selector";
import "../ui/controls/pf-icon-button";
import "@features/image-viewer/pf-image-canvas";

function isIPad(): boolean {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent ?? "";
  return /iPad/i.test(ua) ||
    (/Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
}

@customElement("pf-detail-panel")
export class PfDetailPanel extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--pf-surface);
      color: var(--pf-text);
      overflow: hidden;
    }
    .image-wrap {
      flex: 0 0 auto;
      position: relative;
      background: var(--pf-surface);
      padding: var(--pf-space-3);
      min-height: 0;
      height: min(34vh, 260px);
    }
    pf-image-canvas {
      width: 100%;
      height: 100%;
      border-radius: var(--pf-radius-md);
      overflow: hidden;
      background: var(--pf-surface-2);
    }
    .expand-btn {
      position: absolute;
      top: var(--pf-space-2);
      right: var(--pf-space-2);
      background: var(--pf-surface);
      border-radius: var(--pf-radius-md);
      box-shadow: var(--pf-shadow-md);
      z-index: 1;
    }
    .fullscreen-btn {
      position: absolute;
      top: var(--pf-space-2);
      right: calc(var(--pf-space-2) + 40px);
      background: var(--pf-surface);
      border-radius: var(--pf-radius-md);
      box-shadow: var(--pf-shadow-md);
      z-index: 1;
    }
    .meta {
      padding: var(--pf-space-2) var(--pf-space-3) var(--pf-space-4);
      font-size: var(--pf-text-sm);
      display: flex;
      flex-direction: column;
      gap: var(--pf-space-3);
      overflow-y: auto;
      min-height: 0;
    }
    .filename {
      font-weight: 700;
      font-size: var(--pf-text-base);
      word-break: break-all;
    }
    .photo-facts {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .photo-facts span {
      padding: 3px 6px;
      border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-sm);
      color: var(--pf-text-muted);
      font-size: var(--pf-text-xs);
    }
    .info-section {
      border-top: 1px solid var(--pf-border);
      padding-top: var(--pf-space-3);
    }
    .info-section h3 {
      margin: 0 0 var(--pf-space-2);
      color: var(--pf-text-muted);
      font-size: var(--pf-text-xs);
      font-weight: 600;
    }
    .info-section dl { margin: 0; }
    .info-row {
      display: grid;
      grid-template-columns: 90px minmax(0, 1fr);
      gap: var(--pf-space-2);
      padding: 5px 0;
      font-size: var(--pf-text-xs);
    }
    .info-row dt { color: var(--pf-text-muted); }
    .info-row dd { margin: 0; overflow-wrap: anywhere; }
    .rating-controls, .label-controls { display: inline-flex; align-items: center; gap: 3px; }
    .rating-controls button {
      border: 0;
      background: none;
      padding: 0 2px;
      color: var(--pf-text-subtle);
      font-size: 19px;
      cursor: pointer;
    }
    .rating-controls button.active { color: var(--pf-accent); }
    .label-controls button {
      width: 18px;
      height: 18px;
      padding: 0;
      border: 1px solid var(--pf-border);
      border-radius: 4px;
      opacity: .55;
      cursor: pointer;
    }
    .label-controls button[aria-pressed="true"] { opacity: 1; outline: 2px solid var(--pf-accent); outline-offset: 2px; }
    .path {
      color: var(--pf-text-muted);
      word-break: break-all;
      font-size: var(--pf-text-xs);
    }
  `;

  @property({ attribute: false })
  photo: Photo | null = null;

  @property({ type: Boolean, attribute: "fullviewopen", reflect: true })
  fullViewOpen = false;

  @property({ type: Boolean, attribute: "windowfullscreen", reflect: true })
  windowFullscreen = false;

  @state()
  private variantTick = 0;

  @state()
  private exif: ExifMetadata | null = null;

  @state()
  private ratingTick = 0;

  private exifRequest = 0;
  private unsubscribeRatings: (() => void) | null = null;

  private unsubscribeStore: (() => void) | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribeStore = subscribeVariantOverrides(() => {
      this.variantTick++;
    });
    this.unsubscribeRatings = subscribePhotoRatings(() => { this.ratingTick++; });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.unsubscribeRatings?.();
    this.unsubscribeRatings = null;
    this.exifRequest++;
  }

  protected updated(changed: Map<string, unknown>): void {
    if (!changed.has("photo")) return;
    this.refreshMetadata();
  }

  refreshMetadata(): void {
    const photo = this.photo;
    const request = ++this.exifRequest;
    this.exif = null;
    if (!photo) return;
    void fetchExif(photo.path).then((exif) => {
      if (request === this.exifRequest) this.exif = exif;
    }).catch(() => {
      if (request === this.exifRequest) this.exif = {};
    });
  }

  private currentPath(photo: Photo): string {
    const sel = currentSelection(photo);
    if (!sel) return photo.path;
    return fileForSelection(photo, sel.format, sel.variant) ?? photo.path;
  }

  private openFullView = () => {
    if (!this.photo) return;
    this.dispatchEvent(
      new CustomEvent("photo-open", {
        detail: { path: this.photo.path, filename: this.photo.filename },
        bubbles: true,
        composed: true,
      })
    );
  };

  private toggleFullscreen = () => {
    this.dispatchEvent(
      new CustomEvent("toggle-window-fullscreen", {
        bubbles: true,
        composed: true,
      })
    );
  };

  render() {
    void this.variantTick;
    void this.ratingTick;
    const photo = this.photo;
    if (!photo) {
      return html`
        <div class="image-wrap">
          <pf-image-canvas
            .path=${null}
            fit="contain"
            background="transparent"
          ></pf-image-canvas>
        </div>
        <div class="meta">
          <div class="filename" style="color: var(--pf-text-muted); font-weight: 400;">
            No photo selected
          </div>
        </div>
      `;
    }
    const path = this.currentPath(photo);
    const rating = getPhotoRating(photo.path);
    const sections = buildExifSections(this.exif);
    return html`
      <div class="image-wrap">
        <pf-image-canvas
          .path=${path}
          fit="contain"
          background="transparent"
        ></pf-image-canvas>
        ${this.fullViewOpen || isIPad()
          ? null
          : html`<pf-icon-button
              class="expand-btn"
              icon="expand"
              label="Open full view"
              @click=${this.openFullView}
            ></pf-icon-button>`}
        ${this.fullViewOpen || isIPad()
          ? null
          : html`<pf-icon-button
              class="fullscreen-btn"
              icon=${this.windowFullscreen ? "minimize" : "maximize"}
              label=${this.windowFullscreen
                ? "Exit fullscreen (F)"
                : "Enter fullscreen (F)"}
              @click=${this.toggleFullscreen}
            ></pf-icon-button>`}
      </div>
      <div class="meta">
        <div class="filename">${photo.filename}</div>
        <div class="photo-facts">
          ${photo.extensions?.map((extension) => html`<span>${extension.toUpperCase()}</span>`)}
          ${this.exif?.pixelWidth && this.exif?.pixelHeight ? html`<span>${this.exif.pixelWidth} × ${this.exif.pixelHeight}</span>` : null}
          ${this.exif?.iso ? html`<span>ISO ${this.exif.iso}</span>` : null}
        </div>
        <div class="info-section">
          <div class="info-row"><dt>Rating</dt><dd class="rating-controls" role="group" aria-label="Photo rating">
            ${[1, 2, 3, 4, 5].map((star) => html`<button type="button" class=${star <= rating.rating ? "active" : ""} aria-label=${`${star} stars`} @click=${() => setPhotoStars(photo.path, rating.rating === star ? 0 : star)}>★</button>`)}
          </dd></div>
          <div class="info-row"><dt>Labels</dt><dd class="label-controls" role="group" aria-label="Photo label">
            ${COLOR_LABELS.map((label) => html`<button type="button" style=${`background: ${LABEL_COLORS[label]}`} aria-label=${LABEL_DISPLAY_NAMES[label]} aria-pressed=${rating.label === label} @click=${() => setPhotoLabel(photo.path, rating.label === label ? "" : label)}></button>`)}
          </dd></div>
        </div>
        ${sections.map((section) => html`<section class="info-section">
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

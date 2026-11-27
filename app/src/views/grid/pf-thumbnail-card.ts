import { LitElement, html, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { VIDEO_EXTENSIONS, VideoSources } from "@warble/media";
import { app } from "@app/composition/app";
import "@app/views/rating/pf-rating-overlay";
import "@ui/icons/pf-icon";
import { CardGestureController } from "./card-gesture-controller";
import { thumbnailCardStyles } from "./pf-thumbnail-card.styles";
import { ThumbnailLoadingController } from "./thumbnail-loading-controller";

@customElement("pf-thumbnail-card")
export class PfThumbnailCard extends LitElement {
  static styles = thumbnailCardStyles;

  @property({ type: String })
  path = "";

  @property({ type: String })
  filename = "";

  @property({ attribute: false })
  extensions: string[] = [];

  /** Distinct variants of this photo (`Foo.jpg`, `Foo (edit).jpg`); more than one shows a badge. */
  @property({ type: Number })
  variantCount = 1;

  @property({ type: Boolean, reflect: true })
  selected = false;

  @property({ type: Boolean })
  showSelectionCheck = true;

  private readonly thumbnail = new ThumbnailLoadingController(this, app.media.thumbnails, app.media.videos);
  private readonly gestures = new CardGestureController(this);

  connectedCallback(): void {
    super.connectedCallback();
    this.thumbnail.connect();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.gestures.cancelLongPress();
    this.thumbnail.disconnect();
  }

  willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("path")) this.thumbnail.pathChanged();
  }

  reload(): void {
    this.thumbnail.reload();
  }

  private showFirstVideoFrame(event: Event): void {
    const video = event.target as HTMLVideoElement;
    if (video.duration > 0.1) video.currentTime = 0.1;
  }

  private renderMedia() {
    const { videoUrl, thumbnailUrl, error } = this.thumbnail;
    if (videoUrl) {
      return html`<video src=${videoUrl} draggable="false" muted playsinline preload="metadata"
        @loadedmetadata=${this.showFirstVideoFrame}></video>`;
    }
    if (thumbnailUrl) {
      return html`<img src=${thumbnailUrl} alt=${this.filename} draggable="false" decoding="async" />`;
    }
    if (error) {
      return html`<div class="error" title=${error}>
        <pf-icon name="alert"></pf-icon>
      </div>`;
    }
    return html`<div class="placeholder">
      <pf-icon name="image"></pf-icon>
    </div>`;
  }

  private renderBadge() {
    const { extensions, variantCount } = this;
    const showExtensions = extensions && extensions.length > 1;
    const hasMotion = extensions.some((extension) =>
      VIDEO_EXTENSIONS.some((video) => video === extension.toLowerCase()),
    );
    if (!showExtensions && variantCount <= 1 && !hasMotion) return null;
    const variants = variantCount > 1 ? ` (${variantCount} variants)` : "";
    return html`<div class="badge" title=${`Includes: ${extensions.join(", ")}${variants}`}>
      ${showExtensions ? extensions.map((extension) => html`<span>${extension}</span>`) : null}
      ${variantCount > 1
        ? html`<span class="variants" title=${`${variantCount} variants`}>+${variantCount - 1}</span>`
        : null}
      ${hasMotion ? html`<span>${VideoSources.isVideo(this.path) ? "Video" : "Live"}</span>` : null}
    </div>`;
  }

  render() {
    const { gestures } = this;
    return html`
      <div
        class="card"
        draggable="false"
        @pointerdown=${(event: PointerEvent) => gestures.onPointerDown(event)}
        @pointermove=${(event: PointerEvent) => gestures.onPointerMove(event)}
        @pointerup=${(event: PointerEvent) => gestures.onPointerUp(event)}
        @pointercancel=${() => gestures.cancelLongPress()}
        @pointerleave=${() => gestures.cancelLongPress()}
        @touchmove=${(event: TouchEvent) => gestures.onTouchMove(event)}
        @click=${(event: MouseEvent) => gestures.onClick(event)}
        @dblclick=${(event: MouseEvent) => gestures.onDblClick(event)}
        @contextmenu=${(event: MouseEvent) => gestures.onContextMenu(event)}
      >
        <div class="thumb">
          ${this.selected && this.showSelectionCheck
            ? html`<span class="selection-check" aria-label="Selected">✓</span>`
            : null}
          ${this.renderMedia()}
          ${this.renderBadge()}
          <pf-rating-overlay .path=${this.path}></pf-rating-overlay>
        </div>
        <div class="filename" title=${this.filename}>${this.filename}</div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-thumbnail-card": PfThumbnailCard;
  }
}

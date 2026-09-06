import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  isCancellation,
  requestThumbnail,
  type ThumbnailHandle,
} from "../../app/thumbnail-service";
import { isHdCached, onHdCached } from "../../app/hd-image-cache";
import "../icons/pf-icon";
import "./pf-rating-overlay";

@customElement("pf-thumbnail-card")
export class PfThumbnailCard extends LitElement {
  static styles = css`
    :host {
      display: block;
      width: 100%;
    }
    .card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--pf-space-2);
      padding: var(--pf-space-2);
      border-radius: var(--pf-radius-md);
      background: var(--pf-surface);
      border: 1px solid var(--pf-border);
      cursor: pointer;
      user-select: none;
      transition: border-color var(--pf-transition), box-shadow var(--pf-transition),
        transform var(--pf-transition);
    }
    .card:hover {
      border-color: var(--pf-accent);
    }
    :host([selected]) .card {
      border-color: var(--pf-accent);
      box-shadow: 0 0 0 2px var(--pf-accent-soft);
    }
    .thumb {
      /* Cards stretch to fill their grid cell; the thumbnail is a
         square of the cell width so the photo-grid's slider drives
         thumbnail size by changing the column count. The image
         itself preserves its native aspect (letterboxed inside the
         square) — full-resolution stretching only happens in the
         full image view, where the canvas applies the configured
         scale + margin. */
      width: 100%;
      aspect-ratio: 1 / 1;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--pf-surface-2);
      border-radius: var(--pf-radius-sm);
      overflow: hidden;
      position: relative;
      color: var(--pf-text-subtle);
    }
    .thumb img {
      max-width: 100%;
      max-height: 100%;
      width: auto;
      height: auto;
      object-fit: contain;
      display: block;
    }
    .placeholder {
      font-size: 1.25rem;
      color: var(--pf-text-subtle);
    }
    .filename {
      font-size: var(--pf-text-xs);
      color: var(--pf-text-muted);
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .error {
      display: inline-flex;
      align-items: center;
      gap: var(--pf-space-1);
      font-size: var(--pf-text-xs);
      color: var(--pf-danger);
      padding: var(--pf-space-1);
      text-align: center;
    }
    .badge {
      position: absolute;
      top: var(--pf-space-1);
      right: var(--pf-space-1);
      display: flex;
      gap: 2px;
      pointer-events: none;
    }
    .badge span {
      background: rgba(0, 0, 0, 0.65);
      color: #fff;
      font-size: 0.6rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      padding: 1px 5px;
      border-radius: 999px;
      text-transform: uppercase;
    }
    .badge span.variants {
      background: var(--pf-accent, #4a7);
      text-transform: none;
    }
    /**
     * Small grey checkmark badge in the bottom-left corner indicating
     * the HD-resolution rendition for this photo is already cached on
     * disk. Lights up when the folder-wide HD prewarm finishes for
     * this image, or when the user opens the photo in the full view
     * (which also caches the HD JPEG).
     */
    .hd-badge {
      position: absolute;
      bottom: var(--pf-space-1);
      left: var(--pf-space-1);
      width: 14px;
      height: 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.55);
      color: rgba(255, 255, 255, 0.7);
      border-radius: 999px;
      font-size: 0.55rem;
      line-height: 1;
      pointer-events: none;
    }
  `;

  @property({ type: String })
  path = "";

  @property({ type: String })
  filename = "";

  @property({ attribute: false })
  extensions: string[] = [];

  /** Number of distinct variants for this photo (e.g. `Foo.jpg`,
   *  `Foo (1).jpg`, `Foo (edit).jpg` → 3). When greater than 1, a
   *  badge marks the thumbnail. */
  @property({ type: Number })
  variantCount = 1;

  @property({ type: Boolean, reflect: true })
  selected = false;

  @state()
  private thumbnailUrl: string | null = null;

  @state()
  private error: string | null = null;

  @state()
  private loading = false;

  @state()
  private hdCached = false;

  private observer: IntersectionObserver | null = null;
  private loadedPath: string | null = null;
  private pending: ThumbnailHandle | null = null;
  private unsubscribeHdCached: (() => void) | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    this.startObserving();
    this.hdCached = isHdCached(this.path);
    this.unsubscribeHdCached = onHdCached((cachedPath) => {
      if (cachedPath !== this.path) return;
      if (this.hdCached) return;
      this.hdCached = true;
      // Belt-and-braces: ensure Lit re-renders even if the @state
      // setter optimisation thinks nothing changed (e.g. after a
      // disconnect/reconnect cycle preserved an older value).
      this.requestUpdate();
    });
  }

  /**
   * Forget the currently-displayed thumbnail and re-fetch it. Used after
   * a global cache-clear so on-screen cards drop their stale object URL and
   * re-decode from source instead of reusing the renderer-side cache.
   */
  reload(): void {
    this.pending?.cancel();
    this.pending = null;
    this.clearThumbnailUrl();
    this.error = null;
    this.loading = false;
    this.loadedPath = null;
    if (this.isConnected) {
      this.startObserving();
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.observer?.disconnect();
    this.observer = null;
    this.pending?.cancel();
    this.pending = null;
    this.clearThumbnailUrl();
    this.loadedPath = null;
    this.loading = false;
    this.unsubscribeHdCached?.();
    this.unsubscribeHdCached = null;
  }

  willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("path") && this.path !== this.loadedPath) {
      this.pending?.cancel();
      this.pending = null;
      this.clearThumbnailUrl();
      this.error = null;
      this.loading = false;
      this.loadedPath = null;
      this.hdCached = isHdCached(this.path);
      if (this.isConnected) {
        this.startObserving();
      }
    }
  }

  private startObserving() {
    this.observer?.disconnect();
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            this.observer?.disconnect();
            this.observer = null;
            void this.loadThumbnail();
          }
        }
      },
      { rootMargin: "200px" }
    );
    this.observer.observe(this);
  }

  private async loadThumbnail() {
    if (this.loading || this.loadedPath === this.path) return;
    const requestedPath = this.path;
    this.loading = true;
    const handle = requestThumbnail(requestedPath);
    this.pending = handle;
    try {
      const bytes = await handle.promise;
      if (this.path !== requestedPath) return;
      this.clearThumbnailUrl();
      this.thumbnailUrl = URL.createObjectURL(
        new Blob([bytes], { type: "image/jpeg" })
      );
      this.loadedPath = requestedPath;
      this.dispatchEvent(
        new CustomEvent("thumbnail-load", { bubbles: true, composed: true })
      );
    } catch (e) {
      if (isCancellation(e) || this.path !== requestedPath) return;
      this.error = String(e);
      this.loadedPath = requestedPath;
      this.dispatchEvent(
        new CustomEvent("thumbnail-error", { bubbles: true, composed: true })
      );
    } finally {
      if (this.pending === handle) this.pending = null;
      if (this.path === requestedPath) {
        this.loading = false;
      }
    }
  }

  private clearThumbnailUrl(): void {
    if (this.thumbnailUrl) URL.revokeObjectURL(this.thumbnailUrl);
    this.thumbnailUrl = null;
  }

  render() {
    const showBadge = this.extensions && this.extensions.length > 1;
    return html`
      <div
        class=\"card\"
        @click=${this.onClick}
        @dblclick=${this.onDblClick}
        @contextmenu=${this.onContextMenu}
      >
        <div class="thumb">
          ${this.thumbnailUrl
            ? html`<img src=${this.thumbnailUrl} alt=${this.filename} loading="lazy" />`
            : this.error
            ? html`<div class="error" title=${this.error}>
                <pf-icon name="alert"></pf-icon>
              </div>`
            : html`<div class="placeholder">
                <pf-icon name="image"></pf-icon>
              </div>`}
          ${showBadge || this.variantCount > 1
            ? html`<div
                class="badge"
                title=${`Includes: ${this.extensions.join(", ")}${
                  this.variantCount > 1
                    ? ` (${this.variantCount} variants)`
                    : ""
                }`}
              >
                ${showBadge
                  ? this.extensions.map((e) => html`<span>${e}</span>`)
                  : null}
                ${this.variantCount > 1
                  ? html`<span class="variants"
                      title=${`${this.variantCount} variants`}
                      >+${this.variantCount - 1}</span
                    >`
                  : null}
              </div>`
            : null}
          ${this.hdCached
            ? html`<span
                class="hd-badge"
                title="HD preview cached on disk"
                aria-label="HD preview cached"
                >✓</span
              >`
            : null}
          <pf-rating-overlay .path=${this.path}></pf-rating-overlay>
        </div>
        <div class="filename" title=${this.filename}>${this.filename}</div>
      </div>
    `;
  }

  private onClick = () => {
    this.dispatchEvent(
      new CustomEvent("photo-selected", {
        detail: { path: this.path, filename: this.filename },
        bubbles: true,
        composed: true,
      })
    );
  };

  private onDblClick = (e: MouseEvent) => {
    e.preventDefault();
    this.dispatchEvent(
      new CustomEvent("photo-open", {
        detail: { path: this.path, filename: this.filename },
        bubbles: true,
        composed: true,
      })
    );
  };

  private onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    this.dispatchEvent(
      new CustomEvent("photo-selected", {
        detail: { path: this.path, filename: this.filename },
        bubbles: true,
        composed: true,
      })
    );
    this.dispatchEvent(
      new CustomEvent("photo-context-menu", {
        detail: {
          path: this.path,
          filename: this.filename,
          x: e.clientX,
          y: e.clientY,
        },
        bubbles: true,
        composed: true,
      })
    );
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-thumbnail-card": PfThumbnailCard;
  }
}

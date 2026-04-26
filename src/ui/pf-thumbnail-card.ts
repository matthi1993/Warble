import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  isCancellation,
  requestThumbnail,
  type ThumbnailHandle,
} from "../app/thumbnail-service";

@customElement("pf-thumbnail-card")
export class PfThumbnailCard extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    .card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.35rem;
      padding: 0.5rem;
      border-radius: 0.4rem;
      background: #fff;
      border: 1px solid #e5e5e5;
    }
    .thumb {
      width: 160px;
      height: 160px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #f0f0f0;
      border-radius: 0.25rem;
      overflow: hidden;
      position: relative;
    }
    .thumb img {
      max-width: 100%;
      max-height: 100%;
      display: block;
    }
    .placeholder {
      font-size: 0.7rem;
      color: #999;
    }
    .filename {
      font-size: 0.75rem;
      color: #444;
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .error {
      font-size: 0.7rem;
      color: #b33;
      padding: 0.25rem;
      text-align: center;
    }
  `;

  @property({ type: String })
  path = "";

  @property({ type: String })
  filename = "";

  @state()
  private dataUrl: string | null = null;

  @state()
  private error: string | null = null;

  @state()
  private loading = false;

  private observer: IntersectionObserver | null = null;
  private loadedPath: string | null = null;
  private pending: ThumbnailHandle | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    this.startObserving();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.observer?.disconnect();
    this.observer = null;
    this.pending?.cancel();
    this.pending = null;
  }

  willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("path") && this.path !== this.loadedPath) {
      // Reset state when reused for a different photo.
      this.pending?.cancel();
      this.pending = null;
      this.dataUrl = null;
      this.error = null;
      this.loading = false;
      this.loadedPath = null;
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
      const b64 = await handle.promise;
      if (this.path !== requestedPath) return;
      this.dataUrl = `data:image/jpeg;base64,${b64}`;
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

  render() {
    return html`
      <div class="card">
        <div class="thumb">
          ${this.dataUrl
            ? html`<img src=${this.dataUrl} alt=${this.filename} loading="lazy" />`
            : this.error
            ? html`<div class="error" title=${this.error}>!</div>`
            : html`<div class="placeholder">
                ${this.loading ? "…" : ""}
              </div>`}
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

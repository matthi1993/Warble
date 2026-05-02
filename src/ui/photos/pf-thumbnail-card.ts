import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  isCancellation,
  requestThumbnail,
  type ThumbnailHandle,
} from "../../app/thumbnail-service";
import "../icons/pf-icon";

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
      width: 160px;
      height: 160px;
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
      display: block;
    }
    .placeholder {
      font-size: 1.25rem;
      color: var(--pf-text-subtle);
    }
    .filename {
      font-size: var(--pf-text-xs);
      color: var(--pf-text-muted);
      max-width: 160px;
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

  /**
   * Forget the currently-displayed thumbnail and re-fetch it. Used after
   * a global cache-clear so on-screen cards drop their stale base64 and
   * re-decode from source instead of reusing the renderer-side cache.
   */
  reload(): void {
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

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.observer?.disconnect();
    this.observer = null;
    this.pending?.cancel();
    this.pending = null;
  }

  willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("path") && this.path !== this.loadedPath) {
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
    const showBadge = this.extensions && this.extensions.length > 1;
    return html`
      <div
        class=\"card\"
        @click=${this.onClick}
        @dblclick=${this.onDblClick}
        @contextmenu=${this.onContextMenu}
      >
        <div class="thumb">
          ${this.dataUrl
            ? html`<img src=${this.dataUrl} alt=${this.filename} loading="lazy" />`
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

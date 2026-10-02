import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  isCancellation,
  requestThumbnail,
  type ThumbnailHandle,
} from "@services/images/thumbnail-service";
import "@ui/icons/pf-icon";
import "@features/rating/pf-rating-overlay";
import { isVideoPath, videoSource } from "@services/images/video-source";

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
      align-items: stretch;
      gap: 0;
      padding: 4px;
      border-radius: var(--pf-radius-md);
      background: var(--pf-surface-2);
      border: 1px solid var(--pf-border);
      cursor: pointer;
      user-select: none;
      -webkit-touch-callout: none;
      touch-action: pan-y;
      transition: border-color var(--pf-transition), box-shadow var(--pf-transition),
        transform var(--pf-transition);
    }
    .card:hover {
      border-color: var(--pf-accent);
    }
    :host([selected]) .card {
      border-color: var(--pf-accent);
      box-shadow: 0 0 0 1px var(--pf-accent);
    }
    .selection-check {
      position: absolute;
      top: 6px;
      left: 6px;
      z-index: 2;
      width: 17px;
      height: 17px;
      display: grid;
      place-items: center;
      border-radius: 2px;
      background: #f58a1f;
      color: #fff;
      font-size: 13px;
      font-weight: 700;
      pointer-events: none;
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
      background: var(--pf-bg);
      border-radius: var(--pf-radius-sm);
      overflow: hidden;
      position: relative;
      color: var(--pf-text-subtle);
    }
    .thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      -webkit-user-drag: none;
    }
    .thumb video {
      width: 100%;
      height: 100%;
      object-fit: cover;
      pointer-events: none;
    }
    .placeholder {
      font-size: 1.25rem;
      color: var(--pf-text-subtle);
    }
    .filename {
      font-size: var(--pf-text-xs);
      color: var(--pf-text);
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      padding: 6px 3px 2px;
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
      top: 5px;
      right: 5px;
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
      background: var(--pf-accent);
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

  @property({ type: Boolean })
  showSelectionCheck = true;

  @state()
  private thumbnailUrl: string | null = null;

  @state()
  private videoUrl: string | null = null;

  @state()
  private error: string | null = null;

  @state()
  private loading = false;

  private longPressTimer: number | null = null;
  private touchDragTimer: number | null = null;
  private touchDragArmed = false;
  private longPressStart: { x: number; y: number; time: number } | null = null;
  private suppressClickUntil = 0;
  private suppressContextMenuUntil = 0;
  private lastPointerType = "mouse";

  private observer: IntersectionObserver | null = null;
  private loadedPath: string | null = null;
  private pending: ThumbnailHandle | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    this.startObserving();
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
    this.videoUrl = null;
    this.error = null;
    this.loading = false;
    this.loadedPath = null;
    if (this.isConnected) {
      this.startObserving();
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.cancelLongPress();
    this.observer?.disconnect();
    this.observer = null;
    this.pending?.cancel();
    this.pending = null;
    this.clearThumbnailUrl();
    this.videoUrl = null;
    this.loadedPath = null;
    this.loading = false;
  }

  willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("path") && this.path !== this.loadedPath) {
      this.pending?.cancel();
      this.pending = null;
      this.clearThumbnailUrl();
      this.videoUrl = null;
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
    if (isVideoPath(requestedPath)) {
      try {
        const url = await videoSource(requestedPath);
        if (this.path !== requestedPath || !this.isConnected) return;
        this.videoUrl = url;
        this.loadedPath = requestedPath;
        this.dispatchEvent(new CustomEvent("thumbnail-load", { bubbles: true, composed: true }));
      } catch (error) {
        if (this.path === requestedPath) {
          this.error = String(error);
          this.loadedPath = requestedPath;
        }
      } finally {
        if (this.path === requestedPath) this.loading = false;
      }
      return;
    }
    const handle = requestThumbnail(requestedPath);
    this.pending = handle;
    try {
      const bytes = await handle.promise;
      if (this.path !== requestedPath || this.pending !== handle) return;
      this.clearThumbnailUrl();
      this.thumbnailUrl = URL.createObjectURL(
        new Blob([bytes], { type: "image/jpeg" })
      );
      this.loadedPath = requestedPath;
      this.dispatchEvent(
        new CustomEvent("thumbnail-load", { bubbles: true, composed: true })
      );
    } catch (e) {
      if (isCancellation(e) || this.path !== requestedPath || this.pending !== handle) return;
      this.error = String(e);
      this.loadedPath = requestedPath;
      this.dispatchEvent(
        new CustomEvent("thumbnail-error", { bubbles: true, composed: true })
      );
    } finally {
      if (this.pending === handle) {
        this.pending = null;
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
    const hasMotion = this.extensions.some((extension) => ["mov", "mp4", "m4v"].includes(extension.toLowerCase()));
    const livePhoto = hasMotion && !isVideoPath(this.path);
    return html`
      <div
        class=\"card\"
        draggable="false"
        @pointerdown=${this.onPointerDown}
        @pointermove=${this.onPointerMove}
        @pointerup=${this.onPointerUp}
        @pointercancel=${this.onPointerUp}
        @pointerleave=${this.cancelLongPress}
        @click=${this.onClick}
        @dblclick=${this.onDblClick}
        @contextmenu=${this.onContextMenu}
      >
        <div class="thumb">
          ${this.selected && this.showSelectionCheck ? html`<span class="selection-check" aria-label="Selected">✓</span>` : null}
          ${this.videoUrl
            ? html`<video src=${this.videoUrl} draggable="false" muted playsinline preload="metadata"
                @loadedmetadata=${(event: Event) => {
                  const video = event.target as HTMLVideoElement;
                  if (video.duration > 0.1) video.currentTime = 0.1;
                }}></video>`
            : this.thumbnailUrl
            ? html`<img src=${this.thumbnailUrl} alt=${this.filename} draggable="false" loading="lazy" />`
            : this.error
            ? html`<div class="error" title=${this.error}>
                <pf-icon name="alert"></pf-icon>
              </div>`
            : html`<div class="placeholder">
                <pf-icon name="image"></pf-icon>
              </div>`}
          ${showBadge || this.variantCount > 1 || hasMotion
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
                ${hasMotion ? html`<span>${livePhoto ? "Live" : "Video"}</span>` : null}
              </div>`
            : null}
          <pf-rating-overlay .path=${this.path}></pf-rating-overlay>
        </div>
        <div class="filename" title=${this.filename}>${this.filename}</div>
      </div>
    `;
  }

  private onClick = (e: MouseEvent) => {
    if (Date.now() < this.suppressClickUntil) return;
    this.dispatchEvent(
      new CustomEvent("photo-selected", {
        detail: { path: this.path, filename: this.filename, shiftKey: e.shiftKey, toggle: e.metaKey || e.ctrlKey, touch: this.lastPointerType === "touch" },
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
    if (this.lastPointerType === "touch" && this.longPressStart) return;
    const touchContext = this.longPressStart !== null;
    this.cancelLongPress();
    if (Date.now() < this.suppressContextMenuUntil) return;
    if (touchContext) this.suppressClickUntil = Date.now() + 700;
    this.openContextMenu(e.clientX, e.clientY, touchContext);
  };

  private openContextMenu(x: number, y: number, longPress = false): void {
    this.dispatchEvent(
      new CustomEvent("photo-context-menu", {
        detail: {
          path: this.path,
          filename: this.filename,
          x,
          y,
          longPress,
        },
        bubbles: true,
        composed: true,
      })
    );
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.lastPointerType = event.pointerType;
    if (event.button !== 0 || !event.isPrimary || (event.target as Element).closest("pf-rating-overlay")) return;
    this.cancelLongPress();
    this.longPressStart = { x: event.clientX, y: event.clientY, time: performance.now() };
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort in WebKit.
    }
    if (event.pointerType === "mouse") return;
    if (event.pointerType === "touch") {
      this.touchDragTimer = window.setTimeout(() => { this.touchDragArmed = true; }, 420);
      return;
    }
    this.longPressTimer = window.setTimeout(() => {
      this.longPressTimer = null;
      this.longPressStart = null;
      this.cancelTouchDrag();
      this.suppressClickUntil = Date.now() + 700;
      this.suppressContextMenuUntil = Date.now() + 700;
      this.openContextMenu(event.clientX, event.clientY, true);
    }, 550);
  };

  private onPointerMove = (event: PointerEvent): void => {
    const start = this.longPressStart;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > (event.pointerType === "mouse" ? 6 : 10)) {
      if (event.pointerType === "mouse" || (this.touchDragArmed && event.pointerType === "touch")) {
        this.suppressClickUntil = Date.now() + 700;
        this.suppressContextMenuUntil = Date.now() + 700;
        this.cancelLongPress();
        this.dispatchEvent(new CustomEvent("photo-pointer-drag-start", {
          detail: { path: this.path, pointerId: event.pointerId, x: event.clientX, y: event.clientY },
          bubbles: true,
          composed: true,
        }));
        return;
      }
      this.cancelLongPress();
    }
  };

  private onPointerUp = (): void => {
    const start = this.longPressStart;
    if (this.lastPointerType === "touch" && start && performance.now() - start.time >= 550) {
      this.suppressClickUntil = Date.now() + 700;
      this.suppressContextMenuUntil = Date.now() + 700;
      this.cancelLongPress();
      this.openContextMenu(start.x, start.y, true);
      return;
    }
    if (this.suppressClickUntil > Date.now()) this.suppressClickUntil = Date.now() + 700;
    this.cancelLongPress();
  };

  private cancelLongPress = (): void => {
    if (this.longPressTimer !== null) window.clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
    this.longPressStart = null;
    this.cancelTouchDrag();
  };

  private cancelTouchDrag(): void {
    if (this.touchDragTimer !== null) window.clearTimeout(this.touchDragTimer);
    this.touchDragTimer = null;
    this.touchDragArmed = false;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-thumbnail-card": PfThumbnailCard;
  }
}

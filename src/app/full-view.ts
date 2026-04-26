import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { invoke } from "@tauri-apps/api/core";
import type { Photo } from "./types";
import "../ui/controls/pf-icon-button";

@customElement("pf-full-view")
export class PfFullView extends LitElement {
  static styles = css`
    :host {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: flex;
      flex-direction: column;
      background: rgba(0, 0, 0, 0.92);
      color: #fff;
      outline: none;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: var(--pf-space-2);
      padding: var(--pf-space-2) var(--pf-space-3);
      background: rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(8px);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    .filename {
      font-size: var(--pf-text-sm);
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
    }
    .counter {
      font-size: var(--pf-text-xs);
      color: rgba(255, 255, 255, 0.7);
      font-variant-numeric: tabular-nums;
    }
    .toolbar pf-icon-button {
      color: #fff;
    }
    .toolbar pf-icon-button::part(button) {
      color: #fff;
    }
    .stage {
      flex: 1;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      display: block;
      user-select: none;
      -webkit-user-drag: none;
    }
    .nav {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      width: 48px;
      height: 48px;
      border-radius: 999px;
      border: none;
      background: rgba(0, 0, 0, 0.45);
      color: #fff;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background var(--pf-transition);
    }
    .nav:hover {
      background: rgba(0, 0, 0, 0.75);
    }
    .nav:disabled {
      opacity: 0.3;
      cursor: default;
    }
    .nav.prev {
      left: var(--pf-space-3);
    }
    .nav.next {
      right: var(--pf-space-3);
    }
    .nav pf-icon {
      font-size: 1.5rem;
    }
    .status,
    .error {
      color: rgba(255, 255, 255, 0.75);
      font-size: var(--pf-text-sm);
    }
    .error {
      color: #ff8080;
    }
  `;

  @property({ attribute: false })
  photos: Photo[] = [];

  @property({ type: Number })
  index = 0;

  @state()
  private dataUrl: string | null = null;

  @state()
  private error: string | null = null;

  @state()
  private loading = false;

  @state()
  private isFullscreen = false;

  private loadedPath: string | null = null;
  private onKeyDown = (e: KeyboardEvent) => this.handleKey(e);
  private onFullscreenChange = () => {
    this.isFullscreen = document.fullscreenElement !== null;
  };

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("fullscreenchange", this.onFullscreenChange);
    this.tabIndex = -1;
    queueMicrotask(() => this.focus());
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("fullscreenchange", this.onFullscreenChange);
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
  }

  willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("photos") || changed.has("index")) {
      const photo = this.currentPhoto;
      const path = photo?.path ?? null;
      if (path !== this.loadedPath) {
        this.dataUrl = null;
        this.error = null;
        this.loadedPath = null;
        if (path) {
          void this.load(path);
        }
      }
    }
  }

  private get currentPhoto(): Photo | null {
    if (this.index < 0 || this.index >= this.photos.length) return null;
    return this.photos[this.index] ?? null;
  }

  private async load(path: string) {
    this.loading = true;
    try {
      const b64 = await invoke<string>("get_full_image", { photoPath: path });
      if (this.currentPhoto?.path !== path) return;
      this.dataUrl = `data:image/jpeg;base64,${b64}`;
      this.loadedPath = path;
    } catch (e) {
      if (this.currentPhoto?.path !== path) return;
      this.error = String(e);
      this.loadedPath = path;
    } finally {
      if (this.currentPhoto?.path === path) this.loading = false;
    }
  }

  private handleKey(e: KeyboardEvent) {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      this.go(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      this.go(1);
    } else if (e.key === "Escape") {
      if (document.fullscreenElement) {
        // Let browser exit fullscreen first; don't close.
        return;
      }
      e.preventDefault();
      this.close();
    } else if (e.key === "f" || e.key === "F") {
      e.preventDefault();
      this.toggleFullscreen();
    }
  }

  private go(delta: number) {
    const next = this.index + delta;
    if (next < 0 || next >= this.photos.length) return;
    this.dispatchEvent(
      new CustomEvent("full-view-navigate", {
        detail: { index: next },
        bubbles: true,
        composed: true,
      })
    );
  }

  private close = () => {
    this.dispatchEvent(
      new CustomEvent("full-view-close", { bubbles: true, composed: true })
    );
  };

  private toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await this.requestFullscreen();
      }
    } catch (err) {
      console.error("Fullscreen toggle failed", err);
    }
  };

  render() {
    const photo = this.currentPhoto;
    if (!photo) return html``;
    const total = this.photos.length;
    const hasPrev = this.index > 0;
    const hasNext = this.index < total - 1;
    return html`
      <div class="toolbar">
        <span class="filename" title=${photo.filename}>${photo.filename}</span>
        <span class="counter">${this.index + 1} / ${total}</span>
        <pf-icon-button
          icon=${this.isFullscreen ? "minimize" : "maximize"}
          label=${this.isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          @click=${this.toggleFullscreen}
        ></pf-icon-button>
        <pf-icon-button
          icon="x"
          label="Exit full view"
          @click=${this.close}
        ></pf-icon-button>
      </div>
      <div class="stage">
        <button
          class="nav prev"
          aria-label="Previous"
          ?disabled=${!hasPrev}
          @click=${() => this.go(-1)}
        >
          <pf-icon name="chevron-left"></pf-icon>
        </button>
        ${this.dataUrl
          ? html`<img src=${this.dataUrl} alt=${photo.filename} />`
          : this.error
          ? html`<div class="error">Failed to load: ${this.error}</div>`
          : html`<div class="status">
              ${this.loading ? "Loading…" : ""}
            </div>`}
        <button
          class="nav next"
          aria-label="Next"
          ?disabled=${!hasNext}
          @click=${() => this.go(1)}
        >
          <pf-icon name="chevron-right"></pf-icon>
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-full-view": PfFullView;
  }
}

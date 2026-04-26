import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Photo } from "./types";
import "../ui/controls/pf-icon-button";

type BgColor = "black" | "grey" | "white";
type FitMode = "normal" | "proof";

@customElement("pf-full-view")
export class PfFullView extends LitElement {
  static styles = css`
    :host {
      position: relative;
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      background: var(--pf-fv-bg, #000);
      color: var(--pf-fv-fg, #fff);
      outline: none;
    }
    :host([fullscreen]) {
      position: fixed;
      inset: 0;
      z-index: 1000;
      width: 100vw;
      height: 100vh;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: var(--pf-space-2);
      padding: var(--pf-space-2) var(--pf-space-3);
      background: #111;
      color: #fff;
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
    .group {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 2px;
      background: rgba(255, 255, 255, 0.06);
      border-radius: var(--pf-radius-md);
    }
    .swatch {
      width: 1.4rem;
      height: 1.4rem;
      border-radius: var(--pf-radius-sm);
      border: 1px solid rgba(255, 255, 255, 0.15);
      cursor: pointer;
      padding: 0;
    }
    .swatch.black {
      background: #000;
    }
    .swatch.grey {
      background: #808080;
    }
    .swatch.white {
      background: #fff;
    }
    .swatch[aria-pressed="true"] {
      outline: 2px solid var(--pf-accent);
      outline-offset: 1px;
    }
    .seg {
      background: transparent;
      color: #fff;
      border: none;
      padding: 4px 10px;
      font-size: var(--pf-text-xs);
      border-radius: var(--pf-radius-sm);
      cursor: pointer;
    }
    .seg[aria-pressed="true"] {
      background: rgba(255, 255, 255, 0.18);
    }
    .stage {
      flex: 1;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      background: var(--pf-fv-bg, #000);
    }
    .stage.proof img {
      max-width: calc(100% - 96px);
      max-height: calc(100% - 96px);
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

  @property({ type: Boolean, reflect: true })
  fullscreen = false;

  @state()
  private dataUrl: string | null = null;

  @state()
  private error: string | null = null;

  @state()
  private loading = false;

  @state()
  private bg: BgColor = "black";

  @state()
  private fitMode: FitMode = "normal";

  private loadedPath: string | null = null;
  private onKeyDown = (e: KeyboardEvent) => this.handleKey(e);

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("keydown", this.onKeyDown);
    this.tabIndex = -1;
    queueMicrotask(() => this.focus());
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onKeyDown);
    if (this.fullscreen) {
      void this.setWindowFullscreen(false).catch(() => {});
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
    if (changed.has("bg")) {
      this.style.setProperty("--pf-fv-bg", this.bgCss(this.bg));
      this.style.setProperty(
        "--pf-fv-fg",
        this.bg === "white" ? "#000" : "#fff"
      );
    }
  }

  private bgCss(bg: BgColor): string {
    return bg === "black" ? "#000" : bg === "white" ? "#fff" : "#808080";
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
      e.preventDefault();
      if (this.fullscreen) {
        void this.toggleFullscreen();
      } else {
        this.close();
      }
    } else if (e.key === "f" || e.key === "F") {
      e.preventDefault();
      void this.toggleFullscreen();
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

  private async setWindowFullscreen(enable: boolean) {
    try {
      await getCurrentWindow().setFullscreen(enable);
    } catch (err) {
      console.error("setFullscreen failed", err);
    }
  }

  private toggleFullscreen = async () => {
    const next = !this.fullscreen;
    this.fullscreen = next;
    await this.setWindowFullscreen(next);
  };

  private setBg = (bg: BgColor) => {
    this.bg = bg;
  };

  private setFit = (m: FitMode) => {
    this.fitMode = m;
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
        <span class="group" role="group" aria-label="Background color">
          <button
            class="swatch black"
            aria-label="Black background"
            aria-pressed=${this.bg === "black"}
            @click=${() => this.setBg("black")}
          ></button>
          <button
            class="swatch grey"
            aria-label="Grey background"
            aria-pressed=${this.bg === "grey"}
            @click=${() => this.setBg("grey")}
          ></button>
          <button
            class="swatch white"
            aria-label="White background"
            aria-pressed=${this.bg === "white"}
            @click=${() => this.setBg("white")}
          ></button>
        </span>
        <span class="group" role="group" aria-label="Fit mode">
          <button
            class="seg"
            aria-pressed=${this.fitMode === "normal"}
            @click=${() => this.setFit("normal")}
          >
            Normal
          </button>
          <button
            class="seg"
            aria-pressed=${this.fitMode === "proof"}
            @click=${() => this.setFit("proof")}
          >
            Proof
          </button>
        </span>
        <pf-icon-button
          icon=${this.fullscreen ? "minimize" : "maximize"}
          label=${this.fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          @click=${this.toggleFullscreen}
        ></pf-icon-button>
        <pf-icon-button
          icon="x"
          label="Exit full view"
          @click=${this.close}
        ></pf-icon-button>
      </div>
      <div class="stage ${this.fitMode === "proof" ? "proof" : ""}">
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

/**
 * Modal full-screen photo viewer.
 *
 * Loads encoded image bytes via {@link "../ui/photos/pf-image-canvas"} which
 * paints a thumbnail first and then swaps in the full decoded bitmap, plus
 * offers wheel zoom, drag-pan, and double-click 100%↔fit.
 *
 * Close is intentionally idempotent and bullet-proof:
 *   - ESC always closes in one keypress (we never trap it on the way out).
 *   - The toolbar X is a plain native `<button>` (no shadow-DOM custom
 *     element layered on top), so click/touch events can't be eaten by a
 *     web-component's internals.
 */
import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Photo } from "./types";
import { prefetchFullImages } from "./full-image-cache";
import "../ui/controls/pf-icon-button";
import "../ui/icons/pf-icon";
import "../ui/photos/pf-image-canvas";
import type { ImageFit, PfImageCanvas } from "../ui/photos/pf-image-canvas";

type BgColor = "black" | "grey" | "white";

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
    /* Symmetric placeholder bar at the bottom — same vertical footprint
       as the toolbar so the stage's centre lines up with the viewport's
       centre. When the toolbar fades on idle, this bar fades with it,
       keeping the image visually anchored. */
    .bottombar {
      display: flex;
      align-items: center;
      padding: var(--pf-space-2) var(--pf-space-3);
      background: #111;
      color: #fff;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      min-height: 32px;
      box-sizing: border-box;
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
    .menu-wrap {
      position: relative;
      display: inline-flex;
    }
    .menu-trigger {
      background: rgba(255, 255, 255, 0.06);
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.12);
      padding: 4px 10px;
      font-size: var(--pf-text-xs);
      font-weight: 600;
      border-radius: var(--pf-radius-md);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .menu-trigger:hover {
      background: rgba(255, 255, 255, 0.16);
    }
    .menu-trigger .swatch {
      width: 14px;
      height: 14px;
      border-radius: 3px;
      border: 1px solid rgba(255, 255, 255, 0.25);
    }
    .menu-popup {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      background: #1a1a1a;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: var(--pf-radius-md);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
      padding: 4px;
      z-index: 5;
      min-width: 140px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .menu-item {
      background: transparent;
      color: #fff;
      border: none;
      padding: 6px 10px;
      text-align: left;
      font-size: var(--pf-text-xs);
      border-radius: var(--pf-radius-sm);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .menu-item:hover {
      background: rgba(255, 255, 255, 0.1);
    }
    .menu-item[aria-pressed="true"] {
      background: rgba(255, 255, 255, 0.16);
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
      overflow: hidden;
      background: var(--pf-fv-bg, #000);
      min-height: 0;
    }
    pf-image-canvas {
      position: absolute;
      inset: 0;
    }
    /* In fullscreen, the toolbar and bottombar overlay the stage so that
       fit/proof calculations operate on the full viewport, not the
       reduced area left between the bars. The bars still fade out on
       idle but never resize the canvas underneath. */
    :host([fullscreen]) .toolbar {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      z-index: 3;
      background: rgba(17, 17, 17, 0.85);
      backdrop-filter: blur(6px);
    }
    :host([fullscreen]) .bottombar {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 3;
      background: rgba(17, 17, 17, 0.85);
      backdrop-filter: blur(6px);
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
      z-index: 2;
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
    /* Native close button, never a custom element — guarantees clicks
       reach this handler even if shadow-DOM children get weird. */
    .close-btn {
      background: rgba(255, 255, 255, 0.06);
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: var(--pf-radius-md);
      width: 32px;
      height: 32px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      padding: 0;
    }
    .close-btn:hover {
      background: rgba(255, 255, 255, 0.16);
    }
    .close-btn svg {
      width: 18px;
      height: 18px;
      stroke: currentColor;
      stroke-width: 2;
      fill: none;
    }
    .hint {
      position: absolute;
      bottom: var(--pf-space-3);
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.6);
      color: rgba(255, 255, 255, 0.85);
      font-size: var(--pf-text-xs);
      padding: 4px 10px;
      border-radius: var(--pf-radius-sm);
      pointer-events: none;
      opacity: 0;
      transition: opacity 200ms ease;
    }
    .stage:hover .hint {
      opacity: 1;
    }
    :host([fullscreen][idle]) .toolbar,
    :host([fullscreen][idle]) .bottombar,
    :host([fullscreen][idle]) .nav,
    :host([fullscreen][idle]) .hint {
      opacity: 0;
      pointer-events: none;
    }
    .toolbar,
    .bottombar,
    .nav,
    .hint {
      transition: opacity 200ms ease;
    }
    :host([fullscreen][idle]) {
      cursor: none;
    }
  `;

  @property({ attribute: false })
  photos: Photo[] = [];

  @property({ type: Number })
  index = 0;

  @property({ type: Boolean, reflect: true })
  fullscreen = false;

  @state()
  private bg: BgColor = "black";

  @state()
  private fit: ImageFit = "contain";

  @state()
  private openMenu: "bg" | "fit" | null = null;

  @property({ type: Boolean, reflect: true })
  idle = false;

  private idleTimer: number | null = null;

  private onKeyDown = (e: KeyboardEvent) => this.handleKey(e);
  private onMouseMoveGlobal = () => this.bumpIdle();
  private onDocClick = (e: MouseEvent) => {
    if (!this.openMenu) return;
    const path = e.composedPath();
    if (!path.includes(this)) return;
    // If click is outside any menu-wrap, close.
    const insideMenu = path.some(
      (n) => n instanceof HTMLElement && n.classList?.contains("menu-wrap")
    );
    if (!insideMenu) this.openMenu = null;
  };

  connectedCallback(): void {
    super.connectedCallback();
    // Listen on capture so nothing in our own subtree can swallow ESC.
    window.addEventListener("keydown", this.onKeyDown, { capture: true });
    window.addEventListener("mousemove", this.onMouseMoveGlobal);
    window.addEventListener("click", this.onDocClick, { capture: true });
    this.tabIndex = -1;
    queueMicrotask(() => this.focus());
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onKeyDown, { capture: true } as unknown as EventListenerOptions);
    window.removeEventListener("mousemove", this.onMouseMoveGlobal);
    window.removeEventListener("click", this.onDocClick, { capture: true } as unknown as EventListenerOptions);
    if (this.idleTimer !== null) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private bumpIdle() {
    if (this.idle) this.idle = false;
    if (this.idleTimer !== null) window.clearTimeout(this.idleTimer);
    if (!this.fullscreen) return;
    this.idleTimer = window.setTimeout(() => {
      this.idle = true;
      this.openMenu = null;
    }, 1000);
  }

  willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("bg")) {
      this.style.setProperty("--pf-fv-bg", this.bgCss(this.bg));
      this.style.setProperty(
        "--pf-fv-fg",
        this.bg === "white" ? "#000" : "#fff"
      );
    }
    if (changed.has("fullscreen")) {
      if (this.fullscreen) {
        this.bumpIdle();
      } else {
        if (this.idleTimer !== null) {
          window.clearTimeout(this.idleTimer);
          this.idleTimer = null;
        }
        this.idle = false;
      }
    }
    if (changed.has("photos") || changed.has("index")) {
      this.schedulePrefetch();
    }
  }

  /**
   * Ask the shared full-image LRU to keep the current photo and its
   * neighbours warm. Priority radiates outwards from the active index
   * (current, +1, -1, +2, -2, …) so forward scrolling — the common
   * case — is favoured slightly. The cache caps total entries on its
   * own; we just request more than the cache can hold and let it pick.
   */
  private schedulePrefetch() {
    const total = this.photos.length;
    if (total === 0) return;
    const i = this.index;
    if (i < 0 || i >= total) return;
    const order: string[] = [this.photos[i].path];
    // Up to 19 neighbours — cache holds 20 entries total.
    for (let d = 1; d < total && order.length < 20; d++) {
      const fwd = i + d;
      if (fwd < total) order.push(this.photos[fwd].path);
      if (order.length >= 20) break;
      const back = i - d;
      if (back >= 0) order.push(this.photos[back].path);
    }
    prefetchFullImages(order);
  }

  private bgCss(bg: BgColor): string {
    return bg === "black" ? "#000" : bg === "white" ? "#fff" : "#808080";
  }

  private get currentPhoto(): Photo | null {
    if (this.index < 0 || this.index >= this.photos.length) return null;
    return this.photos[this.index] ?? null;
  }

  private handleKey(e: KeyboardEvent) {
    // `f`, `Escape`, and `g` are owned by the app shell so it can
    // coordinate window fullscreen + view stack across grid and full
    // views. We deliberately do not handle them here.
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      this.go(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      this.go(1);
    } else if (e.key === "p" || e.key === "P") {
      e.preventDefault();
      this.cycleFit();
    } else if (e.key === "b" || e.key === "B") {
      e.preventDefault();
      this.cycleBg();
    } else if (e.key === "0") {
      e.preventDefault();
      this.fit = "contain";
    } else if (e.key === "1") {
      e.preventDefault();
      this.fit = "tight";
    } else if (e.key === "2") {
      e.preventDefault();
      this.fit = "proof";
    }
  }

  private cycleFit() {
    const order: ImageFit[] = ["contain", "tight", "proof"];
    const idx = order.indexOf(this.fit);
    this.fit = order[(idx + 1) % order.length];
    this.openMenu = null;
  }

  private cycleBg() {
    const order: BgColor[] = ["black", "grey", "white"];
    const idx = order.indexOf(this.bg);
    this.bg = order[(idx + 1) % order.length];
    this.openMenu = null;
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
    // Dispatch on the host element. `composed: true` so the event escapes
    // shadow DOM; `bubbles: true` so app-shell sees it.
    this.dispatchEvent(
      new CustomEvent("full-view-close", {
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

  private setBg = (bg: BgColor) => {
    this.bg = bg;
    this.openMenu = null;
  };

  private setFit = (m: ImageFit) => {
    const same = this.fit === m;
    this.fit = m;
    this.openMenu = null;
    if (same) {
      const cv = this.renderRoot.querySelector(
        "pf-image-canvas"
      ) as PfImageCanvas | null;
      cv?.resetView();
    }
  };

  private toggleMenu = (which: "bg" | "fit") => {
    this.openMenu = this.openMenu === which ? null : which;
  };

  private fitLabel(m: ImageFit): string {
    return m === "contain" ? "Fit" : m === "tight" ? "Tight" : "Proof";
  }

  private bgLabel(bg: BgColor): string {
    return bg.charAt(0).toUpperCase() + bg.slice(1);
  }

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
        <span class="menu-wrap">
          <button
            class="menu-trigger"
            type="button"
            aria-haspopup="menu"
            aria-expanded=${this.openMenu === "bg"}
            @click=${() => this.toggleMenu("bg")}
          >
            <span class="swatch" style="background:${this.bgCss(this.bg)}"></span>
            ${this.bgLabel(this.bg)}
            <pf-icon name="chevron-down"></pf-icon>
          </button>
          ${this.openMenu === "bg"
            ? html`<div class="menu-popup" role="menu">
                ${(["black", "grey", "white"] as BgColor[]).map(
                  (b) => html`<button
                    class="menu-item"
                    role="menuitemradio"
                    aria-pressed=${this.bg === b}
                    @click=${() => this.setBg(b)}
                  >
                    <span
                      class="swatch"
                      style="background:${this.bgCss(b)}"
                    ></span>
                    ${this.bgLabel(b)}
                  </button>`
                )}
              </div>`
            : null}
        </span>
        <span class="menu-wrap">
          <button
            class="menu-trigger"
            type="button"
            aria-haspopup="menu"
            aria-expanded=${this.openMenu === "fit"}
            @click=${() => this.toggleMenu("fit")}
          >
            ${this.fitLabel(this.fit)}
            <pf-icon name="chevron-down"></pf-icon>
          </button>
          ${this.openMenu === "fit"
            ? html`<div class="menu-popup" role="menu">
                <button
                  class="menu-item"
                  role="menuitemradio"
                  aria-pressed=${this.fit === "contain"}
                  @click=${() => this.setFit("contain")}
                  title="Fit to panel (0)"
                >
                  Fit
                </button>
                <button
                  class="menu-item"
                  role="menuitemradio"
                  aria-pressed=${this.fit === "tight"}
                  @click=${() => this.setFit("tight")}
                  title="Tight proof — small margin (1)"
                >
                  Tight
                </button>
                <button
                  class="menu-item"
                  role="menuitemradio"
                  aria-pressed=${this.fit === "proof"}
                  @click=${() => this.setFit("proof")}
                  title="Proof — generous margin (2)"
                >
                  Proof
                </button>
              </div>`
            : null}
        </span>
        <pf-icon-button
          icon=${this.fullscreen ? "minimize" : "maximize"}
          label=${this.fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          @click=${this.toggleFullscreen}
        ></pf-icon-button>
        <button
          class="close-btn"
          type="button"
          aria-label="Close full view"
          title="Close (Esc)"
          @click=${this.close}
          @pointerdown=${(e: Event) => e.stopPropagation()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6 L18 18 M18 6 L6 18" stroke-linecap="round" />
          </svg>
        </button>
      </div>
      <div class="stage">
        <pf-image-canvas
          .path=${photo.path}
          .fit=${this.fit}
          background=${this.bgCss(this.bg)}
        ></pf-image-canvas>
        <button
          class="nav prev"
          aria-label="Previous"
          ?disabled=${!hasPrev}
          @click=${() => this.go(-1)}
        >
          <pf-icon name="chevron-left"></pf-icon>
        </button>
        <button
          class="nav next"
          aria-label="Next"
          ?disabled=${!hasNext}
          @click=${() => this.go(1)}
        >
          <pf-icon name="chevron-right"></pf-icon>
        </button>
        <div class="hint">
          Scroll to zoom · drag to pan · double-click to toggle 100% ·
          P proof · B background · F fullscreen · G grid · Esc to close
        </div>
      </div>
      <div class="bottombar" aria-hidden="true"></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-full-view": PfFullView;
  }
}

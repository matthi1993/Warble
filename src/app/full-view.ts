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
import { invoke } from "@tauri-apps/api/core";
import type { Photo } from "./types";
import {
  availableFormats,
  availableVariants,
  fileForSelection,
  primarySelection,
  type PhotoFormat,
} from "./photo-variant";
import {
  getVariantOverride,
  setVariantOverride,
  subscribeVariantOverrides,
} from "./variant-store";
import { prefetchFullImages } from "./full-image-cache";
import {
  ASPECT_RATIO_LABELS,
  ASPECT_RATIO_VALUES,
  getPhotoEdit,
  hasEdits,
  setPhotoCrop,
  subscribePhotoEdits,
  type AspectRatioKey,
  type CropEdit,
  type Orientation,
} from "./edit-store";
import "../ui/controls/pf-icon-button";
import "../ui/icons/pf-icon";
import "../ui/photos/pf-image-canvas";
import type {
  ImageFit,
  ImageSizing,
  PfImageCanvas,
} from "../ui/photos/pf-image-canvas";

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
    .toolbar-left,
    .toolbar-right {
      display: flex;
      align-items: center;
      gap: var(--pf-space-2);
      flex: 1 1 0;
      min-width: 0;
    }
    .toolbar-right {
      justify-content: flex-end;
    }
    .toolbar-center {
      display: flex;
      align-items: center;
      gap: var(--pf-space-2);
      flex: 0 0 auto;
    }
    /* Symmetric placeholder bar at the bottom — same vertical footprint
       as the toolbar so the stage's centre lines up with the viewport's
       centre. When the toolbar fades on idle, this bar fades with it,
       keeping the image visually anchored. */
    .bottombar {
      display: flex;
      align-items: center;
      gap: var(--pf-space-2);
      padding: var(--pf-space-2) var(--pf-space-3);
      background: #111;
      color: #fff;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      min-height: 32px;
      box-sizing: border-box;
    }
    .bottombar .menu-popup {
      top: auto;
      bottom: calc(100% + 6px);
    }
    .filename {
      font-size: var(--pf-text-sm);
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1 1 auto;
      min-width: 0;
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
    .format-switch {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 2px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: var(--pf-radius-md);
    }
    .format-switch button {
      background: transparent;
      color: #fff;
      border: none;
      padding: 2px 10px;
      font-size: var(--pf-text-xs);
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      border-radius: var(--pf-radius-sm);
      cursor: pointer;
      white-space: nowrap;
    }
    .format-switch button[aria-pressed="true"] {
      background: rgba(255, 255, 255, 0.18);
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
    .edit-mark {
      color: var(--pf-accent);
      font-weight: 700;
      line-height: 1;
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
    .edit-btn {
      background: rgba(255, 255, 255, 0.06);
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: var(--pf-radius-md);
      width: 32px;
      height: 32px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      cursor: pointer;
      transition: background var(--pf-transition);
    }
    .edit-btn:hover {
      background: rgba(255, 255, 255, 0.16);
    }
    .edit-btn[aria-pressed="true"] {
      background: var(--pf-accent, #4a90e2);
      border-color: transparent;
    }
    .edit-btn pf-icon {
      font-size: 1rem;
    }
    /* Sub-toolbar that appears directly below the main toolbar while
       editing. In windowed mode it sits in the document flow between
       the main toolbar and the stage; in fullscreen the main toolbar
       floats over the stage so we float this one too, anchored just
       below. */
    .edit-toolbar {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: var(--pf-space-2);
      padding: var(--pf-space-2) var(--pf-space-3);
      background: #181818;
      color: #fff;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      flex-wrap: wrap;
    }
    .edit-toolbar .spacer {
      flex: 1 1 auto;
    }
    :host([fullscreen]) .edit-toolbar {
      position: absolute;
      top: 49px; /* match toolbar height */
      left: 0;
      right: 0;
      z-index: 3;
      background: rgba(24, 24, 24, 0.92);
      backdrop-filter: blur(6px);
    }
    :host([fullscreen][idle]) .edit-toolbar {
      opacity: 0;
      pointer-events: none;
    }
    .edit-toolbar .edit-group {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 2px;
      background: rgba(255, 255, 255, 0.06);
      border-radius: var(--pf-radius-md);
    }
    .edit-toolbar .edit-group button {
      background: transparent;
      color: #fff;
      border: none;
      padding: 4px 10px;
      font-size: var(--pf-text-xs);
      font-weight: 600;
      border-radius: var(--pf-radius-sm);
      cursor: pointer;
      white-space: nowrap;
    }
    .edit-toolbar .edit-group button:hover {
      background: rgba(255, 255, 255, 0.1);
    }
    .edit-toolbar .edit-group button[aria-pressed="true"] {
      background: rgba(255, 255, 255, 0.22);
    }
    .edit-toolbar .edit-action {
      background: rgba(255, 255, 255, 0.08);
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: var(--pf-radius-md);
      padding: 4px 12px;
      font-size: var(--pf-text-xs);
      font-weight: 600;
      cursor: pointer;
    }
    .edit-toolbar .edit-action:hover {
      background: rgba(255, 255, 255, 0.18);
    }
    .edit-toolbar .edit-action.primary {
      background: var(--pf-accent, #4a90e2);
      border-color: transparent;
    }
    .edit-toolbar .edit-action.danger {
      color: #ff8080;
      border-color: rgba(255, 128, 128, 0.4);
    }
    .edit-toolbar .sep {
      width: 1px;
      height: 20px;
      background: rgba(255, 255, 255, 0.16);
    }
    .edit-toolbar .tool-btn {
      background: rgba(255, 255, 255, 0.06);
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: var(--pf-radius-md);
      width: 32px;
      height: 32px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      cursor: pointer;
      transition: background var(--pf-transition);
    }
    .edit-toolbar .tool-btn:hover {
      background: rgba(255, 255, 255, 0.16);
    }
    .edit-toolbar .tool-btn:disabled {
      opacity: 0.35;
      cursor: default;
    }
    .edit-toolbar .tool-btn:disabled:hover {
      background: rgba(255, 255, 255, 0.06);
    }
    .edit-toolbar .tool-btn[aria-pressed="true"] {
      background: var(--pf-accent, #4a90e2);
      border-color: transparent;
    }
    .edit-toolbar .tool-btn.primary {
      background: var(--pf-accent, #4a90e2);
      border-color: transparent;
    }
    .edit-toolbar .tool-btn.primary:hover {
      background: var(--pf-accent-hover, #4a90e2);
    }
    .edit-toolbar .tool-btn pf-icon {
      font-size: 1rem;
    }
    .edit-toolbar,
    .edit-btn {
      transition: opacity 200ms ease;
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
  private sizing: ImageSizing = "fit";

  /** Suppresses the persistence side-effect during the initial hydrate
   * from the DB so we don't write back the same value we just read. */
  private hydrated = false;

  @state()
  private openMenu: "bg" | "fit" | "sizing" | "format" | "variant" | null = null;

  /** Bumped when the shared variant store changes so we re-render. */
  @state()
  private variantTick = 0;

  private unsubscribeStore: (() => void) | null = null;

  @property({ type: Boolean, reflect: true })
  idle = false;

  // --- Edit (crop) state -----------------------------------------------
  @state()
  private editMode = false;

  /**
   * Currently-active edit tool. `null` means the toolbar shows the
   * tool palette; non-null means the tool's parameters are shown and
   * the canvas is in that tool's interactive mode.
   */
  @state()
  private activeEditTool: "crop" | null = null;

  @state()
  private editAspect: AspectRatioKey = "3:2";

  @state()
  private editOrientation: Orientation = "landscape";

  /** Bumped when the edit store changes so the "Edit" button reflects
   * whether the current photo has a saved crop. */
  @state()
  private editsTick = 0;

  private unsubscribeEdits: (() => void) | null = null;

  private idleTimer: number | null = null;

  private onKeyDown = (e: KeyboardEvent) => this.handleKey(e);
  private onMouseMoveGlobal = (e: MouseEvent) => {
    // While controls are visible, any mouse movement resets the idle timer.
    // Once hidden (idle), only movement within the upper area of the viewport
    // brings them back, so casual movement over the image doesn't reveal them.
    if (this.idle) {
      const threshold = Math.max(120, window.innerHeight * 0.2);
      if (e.clientY > threshold) return;
    }
    this.bumpIdle();
  };
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
    this.unsubscribeStore = subscribeVariantOverrides(() => {
      this.variantTick++;
    });
    this.unsubscribeEdits = subscribePhotoEdits(() => {
      this.editsTick++;
    });
    this.tabIndex = -1;
    queueMicrotask(() => this.focus());
    void this.hydrateViewState();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onKeyDown, { capture: true } as unknown as EventListenerOptions);
    window.removeEventListener("mousemove", this.onMouseMoveGlobal);
    window.removeEventListener("click", this.onDocClick, { capture: true } as unknown as EventListenerOptions);
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.unsubscribeEdits?.();
    this.unsubscribeEdits = null;
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
    if ((changed.has("bg") || changed.has("fit") || changed.has("sizing")) &&
      this.hydrated
    ) {
      void this.persistViewState();
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
      // Navigation cancels any active edit session.
      if (this.editMode) {
        this.editMode = false;
        this.activeEditTool = null;
      }
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

  /** Read the persisted background + fit selection from the SQLite
   * `app_settings` row (`view_state`). Missing rows or fields fall
   * back to the constructor defaults so first-run shows a black
   * background with `contain` fit. */
  private async hydrateViewState() {
    try {
      const persisted = await invoke<{
        bg?: string | null;
        fit?: string | null;
        sizing?: string | null;
      } | null>("get_view_state");
      if (persisted) {
        if (persisted.bg === "black" || persisted.bg === "grey" || persisted.bg === "white") {
          this.bg = persisted.bg;
        }
        if (
          persisted.fit === "contain" ||
          persisted.fit === "tight" ||
          persisted.fit === "proof"
        ) {
          this.fit = persisted.fit;
        }
        if (
          persisted.sizing === "fit" ||
          persisted.sizing === "fill" ||
          persisted.sizing === "hybrid"
        ) {
          this.sizing = persisted.sizing;
        }
      }
    } catch (err) {
      console.warn("Failed to load view state", err);
    } finally {
      this.hydrated = true;
    }
  }

  private async persistViewState() {
    try {
      await invoke("set_view_state", {
        view: { bg: this.bg, fit: this.fit, sizing: this.sizing },
      });
    } catch (err) {
      console.warn("Failed to persist view state", err);
    }
  }

  private get currentPhoto(): Photo | null {
    if (this.index < 0 || this.index >= this.photos.length) return null;
    return this.photos[this.index] ?? null;
  }

  private handleKey(e: KeyboardEvent) {
    // `f`, `Escape`, and `g` are owned by the app shell so it can
    // coordinate window fullscreen + view stack across grid and full
    // views. We deliberately do not handle them here.
    if (this.editMode) {
      // Esc / Enter are handled by the editor; stop them so app-shell
      // doesn't also act on them (e.g. closing the full view).
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (this.activeEditTool) {
          this.activeEditTool = null;
        } else {
          this.editMode = false;
        }
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (this.activeEditTool === "crop") {
          void this.saveEdit();
        }
        return;
      }
      // Block navigation/zoom shortcuts so they don't fight the editor.
      if (
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key === "p" ||
        e.key === "P" ||
        e.key === "b" ||
        e.key === "B" ||
        e.key === "0" ||
        e.key === "1" ||
        e.key === "2"
      ) {
        e.preventDefault();
      }
      return;
    }
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

  private setSizing = (s: ImageSizing) => {
    const same = this.sizing === s;
    this.sizing = s;
    this.openMenu = null;
    if (same) {
      const cv = this.renderRoot.querySelector(
        "pf-image-canvas"
      ) as PfImageCanvas | null;
      cv?.resetView();
    }
  };

  private toggleMenu = (which: "bg" | "fit" | "sizing" | "format" | "variant") => {
    this.openMenu = this.openMenu === which ? null : which;
  };

  private currentSelection(
    photo: Photo
  ): { format: PhotoFormat; variant: string } | null {
    const formats = availableFormats(photo);
    if (formats.length === 0) return null;
    const primary = primarySelection(photo);
    const stored = getVariantOverride(photo.path);
    const format = stored?.format ?? primary?.format ?? formats[0];
    const variants = availableVariants(photo, format);
    if (variants.length === 0) return null;
    const requested =
      (stored && stored.format === format ? stored.variant : null) ??
      (primary && primary.format === format ? primary.variant : null) ??
      variants[0].key;
    const final =
      variants.find((v) => v.key === requested)?.key ?? variants[0].key;
    return { format, variant: final };
  }

  private resolvedPath(photo: Photo): string {
    const sel = this.currentSelection(photo);
    if (!sel) return photo.path;
    return fileForSelection(photo, sel.format, sel.variant) ?? photo.path;
  }

  private variantHasEdits(
    photo: Photo,
    format: PhotoFormat,
    variant: string
  ): boolean {
    void this.editsTick;
    const path = fileForSelection(photo, format, variant);
    return path != null && hasEdits(path);
  }

  private setFormat = (format: PhotoFormat) => {
    const photo = this.currentPhoto;
    if (!photo) return;
    const variants = availableVariants(photo, format);
    if (variants.length === 0) return;
    const sel = this.currentSelection(photo);
    const variant =
      variants.find((v) => v.key === sel?.variant)?.key ?? variants[0].key;
    setVariantOverride(photo.path, { format, variant });
    this.openMenu = null;
  };

  private setVariant = (variantKey: string) => {
    const photo = this.currentPhoto;
    if (!photo) return;
    const sel = this.currentSelection(photo);
    if (!sel) return;
    setVariantOverride(photo.path, {
      format: sel.format,
      variant: variantKey,
    });
    this.openMenu = null;
  };

  private bgLabel(bg: BgColor): string {
    return bg.charAt(0).toUpperCase() + bg.slice(1);
  }

  // --- Edit helpers ----------------------------------------------------

  /** Effective aspect ratio (W/H) given the current preset + orientation. */
  private effectiveAspect(): number {
    const a = ASPECT_RATIO_VALUES[this.editAspect];
    return this.editOrientation === "portrait" ? 1 / a : a;
  }

  /** Whether the active selection is a JPEG (only format we edit). */
  private isJpegSelection(): boolean {
    const photo = this.currentPhoto;
    if (!photo) return false;
    const sel = this.currentSelection(photo);
    return sel?.format === "jpg";
  }

  /** The path the canvas is actually displaying — i.e. the resolved
   * variant file. This is what the cache, the Rust full-image
   * command, and therefore the edit store must all agree on. */
  private editTargetPath(): string | null {
    const photo = this.currentPhoto;
    if (!photo) return null;
    return this.resolvedPath(photo);
  }

  /** Currently saved crop on the active photo, if any. */
  private currentSavedCrop(): CropEdit | null {
    void this.editsTick;
    const target = this.editTargetPath();
    if (!target) return null;
    return getPhotoEdit(target)?.crop ?? null;
  }

  private toggleEditMode = () => {
    if (this.editMode) {
      this.editMode = false;
      this.activeEditTool = null;
      return;
    }
    if (!this.isJpegSelection()) return;
    this.editMode = true;
    this.activeEditTool = null;
    this.openMenu = null;
  };

  private openTool = (tool: "crop") => {
    if (tool === "crop") {
      const saved = this.currentSavedCrop();
      if (saved) {
        this.editAspect = saved.aspectRatio;
        this.editOrientation = saved.orientation;
      }
    }
    this.activeEditTool = tool;
  };

  private setEditAspect = (a: AspectRatioKey) => {
    this.editAspect = a;
  };

  private setEditOrientation = (o: Orientation) => {
    this.editOrientation = o;
  };

  private saveEdit = async () => {
    const target = this.editTargetPath();
    if (!target) return;
    const cv = this.renderRoot.querySelector(
      "pf-image-canvas"
    ) as PfImageCanvas | null;
    const frame = cv?.getCropFrame();
    if (!frame) {
      this.activeEditTool = null;
      return;
    }
    const crop: CropEdit = {
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      aspectRatio: this.editAspect,
      orientation: this.editOrientation,
    };
    // Await persistence + cache invalidation BEFORE leaving crop mode
    // so the canvas's subsequent reload reads the freshly-written edit.
    await setPhotoCrop(target, crop);
    this.activeEditTool = null;
  };

  private cancelEdit = () => {
    this.activeEditTool = null;
  };

  private resetAllEdits = async () => {
    const target = this.editTargetPath();
    if (!target) return;
    if (!hasEdits(target)) return;
    await setPhotoCrop(target, null);
    this.activeEditTool = null;
  };

  private renderEditToolbar() {
    void this.editsTick;
    const target = this.editTargetPath();
    const anyEdits = target ? hasEdits(target) : false;
    return html`
      <div
        class="edit-toolbar"
        role="toolbar"
        aria-label="Edit tools"
        @click=${(e: Event) => e.stopPropagation()}
      >
        ${this.activeEditTool === null
          ? this.renderToolPalette()
          : this.activeEditTool === "crop"
          ? this.renderCropParams()
          : null}
        <span class="spacer" aria-hidden="true"></span>
        <button
          type="button"
          class="tool-btn"
          title="Reset all edits"
          aria-label="Reset all edits"
          ?disabled=${!anyEdits}
          @click=${this.resetAllEdits}
        >
          <pf-icon name="rotate-ccw"></pf-icon>
        </button>
      </div>
    `;
  }

  private renderToolPalette() {
    return html`
      <button
        type="button"
        class="tool-btn"
        title="Crop"
        aria-label="Crop"
        @click=${() => this.openTool("crop")}
      >
        <pf-icon name="crop"></pf-icon>
      </button>
    `;
  }

  private renderCropParams() {
    const aspects: AspectRatioKey[] = [
      "3:2",
      "1:1",
      "4:3",
      "panavision",
      "super-panavision",
    ];
    return html`
      <div class="edit-group" role="group" aria-label="Aspect ratio">
        ${aspects.map(
          (a) => html`<button
            type="button"
            aria-pressed=${this.editAspect === a}
            @click=${() => this.setEditAspect(a)}
          >
            ${ASPECT_RATIO_LABELS[a]}
          </button>`
        )}
      </div>
      <div class="edit-group" role="group" aria-label="Orientation">
        <button
          type="button"
          aria-pressed=${this.editOrientation === "landscape"}
          @click=${() => this.setEditOrientation("landscape")}
        >
          Landscape
        </button>
        <button
          type="button"
          aria-pressed=${this.editOrientation === "portrait"}
          @click=${() => this.setEditOrientation("portrait")}
        >
          Portrait
        </button>
      </div>
      <span class="sep" aria-hidden="true"></span>
      <button
        type="button"
        class="tool-btn"
        title="Cancel (Esc)"
        aria-label="Cancel"
        @click=${this.cancelEdit}
      >
        <pf-icon name="x"></pf-icon>
      </button>
      <button
        type="button"
        class="tool-btn primary"
        title="Apply (Enter)"
        aria-label="Apply"
        @click=${this.saveEdit}
      >
        <pf-icon name="check"></pf-icon>
      </button>
    `;
  }

  private fitLabel(m: ImageFit): string {
    return m === "contain" ? "None" : m === "tight" ? "Tight" : "Proof";
  }

  private sizingLabel(s: ImageSizing): string {
    return s === "fit" ? "Contain" : s === "fill" ? "Cover" : "Hybrid";
  }

  render() {
    const photo = this.currentPhoto;
    if (!photo) return html``;
    const total = this.photos.length;
    const hasPrev = this.index > 0;
    const hasNext = this.index < total - 1;
    const sel = this.currentSelection(photo);
    const formats = availableFormats(photo);
    const variants =
      sel !== null ? availableVariants(photo, sel.format) : [];
    const path = this.resolvedPath(photo);
    return html`
      <div class="toolbar">
        <div class="toolbar-left">
          <span class="filename" title=${photo.filename}>${photo.filename}</span>
          <span class="counter">${this.index + 1} / ${total}</span>
        </div>
        <div class="toolbar-center">
          ${sel !== null && formats.length > 1
            ? html`<div
                class="format-switch"
                role="group"
                aria-label="File format"
              >
                ${formats.map(
                  (f) => html`<button
                    aria-pressed=${sel.format === f}
                    @click=${() => this.setFormat(f)}
                  >
                    ${f}
                  </button>`
                )}
              </div>`
            : null}
          ${sel !== null && variants.length > 1
            ? html`<span class="menu-wrap">
                <button
                  class="menu-trigger"
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded=${this.openMenu === "variant"}
                  @click=${() => this.toggleMenu("variant")}
                >
                  ${variants.find((v) => v.key === sel.variant)?.label ??
                  sel.variant}
                  ${this.variantHasEdits(photo, sel.format, sel.variant)
                    ? html`<span class="edit-mark" aria-label="Edited">*</span>`
                    : null}
                  <pf-icon name="chevron-down"></pf-icon>
                </button>
                ${this.openMenu === "variant"
                  ? html`<div class="menu-popup" role="menu">
                      ${variants.map(
                        (v) => html`<button
                          class="menu-item"
                          role="menuitemradio"
                          aria-pressed=${sel.variant === v.key}
                          @click=${() => this.setVariant(v.key)}
                        >
                          ${v.label}
                          ${this.variantHasEdits(photo, sel.format, v.key)
                            ? html`<span class="edit-mark" aria-label="Edited">*</span>`
                            : null}
                        </button>`
                      )}
                    </div>`
                  : null}
              </span>`
            : null}
          ${this.isJpegSelection()
            ? html`<button
                class="edit-btn"
                type="button"
                aria-pressed=${this.editMode}
                aria-label=${this.editMode ? "Close edit" : "Edit photo"}
                title=${this.editMode ? "Close edit" : "Edit photo"}
                @click=${this.toggleEditMode}
              >
                <pf-icon name="pencil"></pf-icon>
              </button>`
            : null}
        </div>
        <div class="toolbar-right">
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
      </div>
      ${this.editMode ? this.renderEditToolbar() : null}
      <div class="stage">
        <pf-image-canvas
          .path=${path}
          .fit=${this.fit}
          .sizing=${this.editMode ? "fit" : this.sizing}
          .cropMode=${this.editMode && this.activeEditTool === "crop"}
          .cropAspect=${this.editMode && this.activeEditTool === "crop"
            ? this.effectiveAspect()
            : null}
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
      <div class="bottombar">
        <span class="menu-wrap">
          <button
            class="menu-trigger"
            type="button"
            aria-haspopup="menu"
            aria-expanded=${this.openMenu === "bg"}
            @click=${() => this.toggleMenu("bg")}
          >
            <span class="swatch" style="background:${this.bgCss(this.bg)}"></span>
            BG Color: ${this.bgLabel(this.bg)}
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
            Margin: ${this.fitLabel(this.fit)}
            <pf-icon name="chevron-down"></pf-icon>
          </button>
          ${this.openMenu === "fit"
            ? html`<div class="menu-popup" role="menu">
                <button
                  class="menu-item"
                  role="menuitemradio"
                  aria-pressed=${this.fit === "contain"}
                  @click=${() => this.setFit("contain")}
                  title="No margin — image flush to the panel edges (0)"
                >
                  None
                </button>
                <button
                  class="menu-item"
                  role="menuitemradio"
                  aria-pressed=${this.fit === "tight"}
                  @click=${() => this.setFit("tight")}
                  title="Tight margin (1)"
                >
                  Tight
                </button>
                <button
                  class="menu-item"
                  role="menuitemradio"
                  aria-pressed=${this.fit === "proof"}
                  @click=${() => this.setFit("proof")}
                  title="Generous proof margin (2)"
                >
                  Proof
                </button>
              </div>`
            : null}
        </span>
        <span class="menu-wrap">
          <button
            class="menu-trigger"
            type="button"
            aria-haspopup="menu"
            aria-expanded=${this.openMenu === "sizing"}
            @click=${() => this.toggleMenu("sizing")}
          >
            Scale: ${this.sizingLabel(this.sizing)}
            <pf-icon name="chevron-down"></pf-icon>
          </button>
          ${this.openMenu === "sizing"
            ? html`<div class="menu-popup" role="menu">
                <button
                  class="menu-item"
                  role="menuitemradio"
                  aria-pressed=${this.sizing === "fit"}
                  @click=${() => this.setSizing("fit")}
                  title="Image fully visible inside the margin"
                >
                  Contain
                </button>
                <button
                  class="menu-item"
                  role="menuitemradio"
                  aria-pressed=${this.sizing === "fill"}
                  @click=${() => this.setSizing("fill")}
                  title="Image fills the stage (may crop)"
                >
                  Cover
                </button>
                <button
                  class="menu-item"
                  role="menuitemradio"
                  aria-pressed=${this.sizing === "hybrid"}
                  @click=${() => this.setSizing("hybrid")}
                  title="Cover for wide landscape (≥3:2), contain otherwise"
                >
                  Hybrid
                </button>
              </div>`
            : null}
        </span>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-full-view": PfFullView;
  }
}

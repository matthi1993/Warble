/**
 * Modal full-screen photo viewer.
 *
 * Owns:
 *   - navigation (`go`, `close`, fullscreen toggle, variant menu),
 *   - view state (fit / sizing / bg, persisted via SQLite),
 *   - the three-tab right panel (Info / Edit / Post Process),
 *   - cursor-idle behaviour and the edit-panel reveal,
 *   - press-and-hold before/after preview,
 *   - the master "Revert all" affordance.
 *
 * Tool-specific state (crop frame, tone sliders, key handling, canvas
 * wiring) is delegated to the `EditTool` subclasses under `tools/`.
 * Variant resolution, EXIF loading, and cursor-idle tracking are
 * extracted into sibling helpers so this shell stays focused on
 * orchestration and rendering.
 */
import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Photo } from "@domain/photo";
import {
  availableVariants,
  fileForSelection,
  type PhotoFormat,
} from "@domain/photo";
import {
  setVariantOverride,
  subscribeVariantOverrides,
} from "@app/variant-store";
import { prefetchHdImages } from "@app/hd-image-cache";
import { applyRatingShortcut } from "@services/rating/rating-store";
import { RATING_LABEL_KEYS } from "@domain/rating";
import {
  flushPhotoEdit,
  hasEdits,
  subscribePhotoEdits,
} from "@services/edits/edits-store";
import {
  DEFAULT_VIEW_STATE,
  loadViewState,
  saveViewState,
  type BgColor,
} from "@services/view-state/view-state-service";
import "@ui/controls/pf-icon-button";
import "@ui/controls/pf-slider";
import "@ui/icons/pf-icon";
import "@ui/photos/pf-image-canvas";
import "@ui/photos/pf-rating-overlay";
import type {
  ImageFit,
  ImageSizing,
  PfImageCanvas,
} from "@ui/photos/pf-image-canvas";
import "./views/full-view/pf-info-card";
import "./views/full-view/pf-edit-side-panel";
import "./views/full-view/pf-post-process-card";
import { fullViewStyles } from "./views/full-view/styles";
import {
  renderBottombar,
  renderToolbar,
  type FullViewMenu,
} from "./views/full-view/chrome";
import type { EditTool, ToolHost } from "./views/full-view/tools/edit-tool";
import { CropTool } from "./views/full-view/tools/crop-tool";
import { ToneTool } from "./views/full-view/tools/tone-tool";
import {
  currentSelection,
  isJpegSelection,
  resolvedPath,
} from "./views/full-view/variant-selector";
import { IdleController } from "./views/full-view/idle-controller";
import { ExifLoader } from "./views/full-view/exif-loader";

type SidePanelTab = "info" | "edit" | "post";

@customElement("pf-full-view")
export class PfFullView extends LitElement {
  static styles = fullViewStyles;

  @property({ attribute: false })
  photos: Photo[] = [];

  @property({ type: Number })
  index = 0;

  @property({ type: Boolean, reflect: true })
  fullscreen = false;

  @state()
  private bg: BgColor = DEFAULT_VIEW_STATE.bg;

  @state()
  private fit: ImageFit = DEFAULT_VIEW_STATE.fit;

  @state()
  private sizing: ImageSizing = DEFAULT_VIEW_STATE.sizing;

  /** Suppresses the persistence side-effect during the initial hydrate. */
  private hydrated = false;

  @state()
  private openMenu: FullViewMenu | null = null;

  /** Bumped when the shared variant store changes so we re-render. */
  @state()
  private variantTick = 0;

  /** Bumped on every edit-store notification so dependent getters
   *  (e.g. "does any tool have edits?") refresh. */
  @state()
  private editsTick = 0;

  private unsubscribeStore: (() => void) | null = null;
  private unsubscribeEdits: (() => void) | null = null;

  @property({ type: Boolean, reflect: true })
  idle = false;

  /** Reflects whether the rail + (optional) panel content are
   *  currently revealed in fullscreen. Driven by cursor proximity to
   *  the right edge or hover over the rail/panel. Inert in windowed
   *  mode (rail is always shown). */
  @property({ type: Boolean, reflect: true, attribute: "edit-panel-visible" })
  editPanelVisible = false;

  /** Reflects whether the panel content (any tab) is expanded.
   *  Equivalent to `activeTab !== null`. */
  @property({ type: Boolean, reflect: true, attribute: "edit-panel-open" })
  editPanelOpen = false;

  /** Active side-panel tab, or null if the panel is collapsed. */
  @state()
  private activeTab: SidePanelTab | null = null;

  /** Press-and-hold preview of the original (un-edited) image. */
  @state()
  private previewOriginal = false;

  // --- Edit tools ----------------------------------------------------
  private cropTool = new CropTool();
  private toneTool = new ToneTool();
  private tools: EditTool[] = [this.cropTool, this.toneTool];
  /** The tool currently in foreground/interactive mode. Crop is the
   *  only one that takes over the canvas; tone runs passively. */
  @state()
  private activeToolId: string | null = null;

  private exifLoader = new ExifLoader(() => this.requestUpdate());

  private idleController = new IdleController({
    isFullscreen: () => this.fullscreen,
    isEditMode: () => this.editMode,
    isEditPanelVisible: () => this.editPanelVisible,
    onIdleChange: (v) => {
      this.idle = v;
      if (v) this.openMenu = null;
    },
  });

  /** Edit affordances are always available for JPEGs. */
  private get editMode(): boolean {
    return isJpegSelection(this.currentPhoto);
  }

  /** Adapter object passed to tools. */
  private toolHost: ToolHost;

  constructor() {
    super();
    const host = this;
    this.toolHost = {
      get editTarget(): string | null {
        return host.editTargetPath();
      },
      get canvas(): PfImageCanvas | null {
        return host.canvasEl();
      },
      requestUpdate: () => host.requestUpdate(),
      revealEditPanel: () => host.openTab("edit"),
      flushActiveEdit: async () => {
        const t = host.editTargetPath();
        if (t) await flushPhotoEdit(t);
      },
    };
  }

  private onKeyDown = (e: KeyboardEvent) => this.handleKey(e);

  private onMouseMoveGlobal = (e: MouseEvent) => {
    if (this.editMode && this.fullscreen) {
      const nearRight = e.clientX > window.innerWidth - 80;
      const overRailOrPanel = this.cursorOverEditRailOrPanelXY(
        e.clientX,
        e.clientY
      );
      this.editPanelVisible = nearRight || overRailOrPanel;
    }
    this.idleController.onMouseMove(e.clientX, e.clientY);
  };

  private onDocClick = (e: MouseEvent) => {
    if (!this.openMenu) return;
    const path = e.composedPath();
    if (!path.includes(this)) return;
    const insideMenu = path.some(
      (n) => n instanceof HTMLElement && n.classList?.contains("menu-wrap")
    );
    if (!insideMenu) this.openMenu = null;
  };

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("keydown", this.onKeyDown, { capture: true });
    window.addEventListener("mousemove", this.onMouseMoveGlobal);
    window.addEventListener("click", this.onDocClick, { capture: true });
    this.unsubscribeStore = subscribeVariantOverrides(() => {
      this.variantTick++;
    });
    this.unsubscribeEdits = subscribePhotoEdits((path) => {
      this.editsTick++;
      // Empty path = store-wide "everything cleared" wildcard.
      if (path === "") this.toneTool.invalidateMirror();
    });
    this.tabIndex = -1;
    queueMicrotask(() => this.focus());
    void this.hydrateViewState();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    const t = this.editTargetPath();
    if (t) void flushPhotoEdit(t);
    window.removeEventListener("keydown", this.onKeyDown, {
      capture: true,
    } as unknown as EventListenerOptions);
    window.removeEventListener("mousemove", this.onMouseMoveGlobal);
    window.removeEventListener("click", this.onDocClick, {
      capture: true,
    } as unknown as EventListenerOptions);
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.unsubscribeEdits?.();
    this.unsubscribeEdits = null;
    this.idleController.dispose();
  }

  willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("bg")) {
      this.style.setProperty("--pf-fv-bg", this.bgCss(this.bg));
      this.style.setProperty(
        "--pf-fv-fg",
        this.bg === "white" ? "#000" : "#fff"
      );
    }
    if (
      (changed.has("bg") || changed.has("fit") || changed.has("sizing")) &&
      this.hydrated
    ) {
      void saveViewState({ bg: this.bg, fit: this.fit, sizing: this.sizing });
    }
    if (changed.has("fullscreen")) {
      if (this.fullscreen) this.idleController.bump();
      else this.idleController.reset();
      requestAnimationFrame(() => this.canvasEl()?.resetView());
    }
    if (changed.has("photos") || changed.has("index")) {
      const prevTarget = this.editTargetPath();
      if (prevTarget) void flushPhotoEdit(prevTarget);
      this.schedulePrefetch();
      // Navigating cancels any active tool (crop hijack). Tool state
      // was already flushed above; we just close the canvas takeover.
      if (this.activeToolId) {
        this.activeTool()?.deactivate(this.toolHost);
        this.activeToolId = null;
      }
      this.previewOriginal = false;
      if (!this.editMode) {
        this.editPanelVisible = false;
        if (this.activeTab !== null) {
          this.activeTab = null;
          this.editPanelOpen = false;
        }
      }
    }
    if (changed.has("activeTab")) {
      this.editPanelOpen = this.activeTab !== null;
    }
    this.syncToolsFromStore();
    this.exifLoader.syncToPath(this.editTargetPath());
  }

  /** Re-hydrate every tool's mirror against the active target. */
  private syncToolsFromStore() {
    const target = this.editTargetPath();
    for (const t of this.tools) t.syncFromStore(target);
  }

  /**
   * Keep the current photo and its neighbours warm in the shared
   * full-image LRU. Priority radiates outwards from the active index
   * so forward scrolling — the common case — wins by one slot.
   */
  private schedulePrefetch() {
    const total = this.photos.length;
    if (total === 0) return;
    const i = this.index;
    if (i < 0 || i >= total) return;
    const order: string[] = [this.photos[i].path];
    for (let d = 1; d < total && order.length < 20; d++) {
      const fwd = i + d;
      if (fwd < total) order.push(this.photos[fwd].path);
      if (order.length >= 20) break;
      const back = i - d;
      if (back >= 0) order.push(this.photos[back].path);
    }
    prefetchHdImages(order);
  }

  private bgCss(bg: BgColor): string {
    return bg === "black" ? "#000" : bg === "white" ? "#fff" : "#808080";
  }

  /** Read the persisted background + fit selection from SQLite. */
  private async hydrateViewState() {
    const persisted = await loadViewState();
    if (persisted.bg) this.bg = persisted.bg;
    if (persisted.fit) this.fit = persisted.fit;
    if (persisted.sizing) this.sizing = persisted.sizing;
    this.hydrated = true;
  }

  private get currentPhoto(): Photo | null {
    if (this.index < 0 || this.index >= this.photos.length) return null;
    return this.photos[this.index] ?? null;
  }

  private canvasEl(): PfImageCanvas | null {
    return this.renderRoot.querySelector(
      "pf-image-canvas"
    ) as PfImageCanvas | null;
  }

  private activeTool(): EditTool | null {
    return this.tools.find((t) => t.id === this.activeToolId) ?? null;
  }

  /** The path the canvas is actually displaying — i.e. the resolved
   * variant file. The cache, the Rust full-image command, and the
   * edit store must all agree on this. */
  private editTargetPath(): string | null {
    const photo = this.currentPhoto;
    if (!photo) return null;
    return resolvedPath(photo);
  }

  private handleKey(e: KeyboardEvent) {
    // `f`, `Escape`, and `g` are owned by the app shell so it can
    // coordinate window fullscreen + view stack. We don't trap them.
    const active = this.activeTool();
    // Tool gets first shot at keys it cares about, but global
    // shortcuts (c/b/i/arrows/ratings) still work so the user can
    // exit or switch tools without first pressing Escape.
    if (active && active.handleKey(e, this.toolHost)) {
      this.requestUpdate();
      return;
    }
    if (e.key === "Escape" || e.key === "Enter") {
      if (active) {
        active.deactivate(this.toolHost);
        this.activeToolId = null;
      }
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      this.go(-1);
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      this.go(1);
      return;
    }
    if (e.key === "p" || e.key === "P") {
      e.preventDefault();
      this.cycleFit();
      return;
    }
    if (e.key === "i" || e.key === "I") {
      if (this.editMode) {
        e.preventDefault();
        this.toggleTab("info");
      }
      return;
    }
    if (e.key === "c" || e.key === "C") {
      if (this.editMode) {
        e.preventDefault();
        this.toggleTool(this.cropTool);
      }
      return;
    }
    if (e.key === "b" || e.key === "B") {
      if (this.editMode) {
        e.preventDefault();
        this.toggleToneCard();
      }
      return;
    }
    if (RATING_LABEL_KEYS.has(e.key)) {
      const photo = this.currentPhoto;
      if (photo) {
        e.preventDefault();
        applyRatingShortcut(photo.path, e.key);
      }
    }
  }

  private cycleFit() {
    const order: ImageFit[] = ["contain", "tight", "proof"];
    const idx = order.indexOf(this.fit);
    this.fit = order[(idx + 1) % order.length];
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
    this.dispatchEvent(
      new CustomEvent("full-view-close", { bubbles: true, composed: true })
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
    if (same) this.canvasEl()?.resetView();
  };

  private setSizing = (s: ImageSizing) => {
    const same = this.sizing === s;
    this.sizing = s;
    this.openMenu = null;
    if (same) this.canvasEl()?.resetView();
  };

  private toggleMenu = (which: FullViewMenu) => {
    this.openMenu = this.openMenu === which ? null : which;
  };

  private variantHasEdits = (
    photo: Photo,
    format: PhotoFormat,
    variant: string
  ): boolean => {
    void this.editsTick;
    const path = fileForSelection(photo, format, variant);
    return path != null && hasEdits(path);
  };

  private setFormat = (format: PhotoFormat) => {
    const photo = this.currentPhoto;
    if (!photo) return;
    const variants = availableVariants(photo, format);
    if (variants.length === 0) return;
    const sel = currentSelection(photo);
    const variant =
      variants.find((v) => v.key === sel?.variant)?.key ?? variants[0].key;
    setVariantOverride(photo.path, { format, variant });
    this.openMenu = null;
  };

  private setVariant = (variantKey: string) => {
    const photo = this.currentPhoto;
    if (!photo) return;
    const sel = currentSelection(photo);
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

  // --- Tab control ---------------------------------------------------

  /** Open a specific tab (no-op if already on it). */
  private openTab(tab: SidePanelTab) {
    if (this.activeTab !== tab) this.activeTab = tab;
  }

  /** Toggle a tab: open if closed/other tab; collapse panel if same. */
  private toggleTab(tab: SidePanelTab) {
    this.activeTab = this.activeTab === tab ? null : tab;
  }

  /** Crop tool: takes over the canvas. */
  private toggleTool(tool: EditTool) {
    this.openTab("edit");
    if (this.activeToolId === tool.id) {
      tool.deactivate(this.toolHost);
      this.activeToolId = null;
    } else {
      this.activeTool()?.deactivate(this.toolHost);
      tool.activate(this.toolHost);
      this.activeToolId = tool.id;
    }
  }

  /** Tone card: passive, no canvas takeover. */
  private toggleToneCard() {
    this.openTab("edit");
    this.toneTool.cardOpen = !this.toneTool.cardOpen;
    this.requestUpdate();
  }

  // --- Right-side rail/panel cursor hit-testing ----------------------

  private cursorOverEditPanelXY(x: number, y: number): boolean {
    const panel = this.renderRoot.querySelector(
      "pf-edit-side-panel"
    ) as HTMLElement | null;
    if (!panel) return false;
    const rect = panel.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    return (
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    );
  }

  private cursorOverEditRailOrPanelXY(x: number, y: number): boolean {
    if (this.cursorOverEditPanelXY(x, y)) return true;
    const rail = this.renderRoot.querySelector(
      ".edit-side-rail"
    ) as HTMLElement | null;
    if (!rail) return false;
    const rect = rail.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    return (
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    );
  }

  // --- Before/After preview ------------------------------------------

  private startPreviewOriginal = (e: Event) => {
    if (!this.canPreviewOriginal()) return;
    e.preventDefault();
    this.previewOriginal = true;
    const target = e.currentTarget as HTMLElement;
    if (
      target &&
      "setPointerCapture" in target &&
      (e as PointerEvent).pointerId != null
    ) {
      try {
        target.setPointerCapture((e as PointerEvent).pointerId);
      } catch {
        /* capture is best-effort */
      }
    }
  };

  private endPreviewOriginal = () => {
    if (!this.previewOriginal) return;
    this.previewOriginal = false;
  };

  private canPreviewOriginal(): boolean {
    void this.editsTick;
    const target = this.editTargetPath();
    return !!target && hasEdits(target);
  }

  /** Drop every tool's persisted edits on the active target. */
  private resetAllEdits = async () => {
    for (const t of this.tools) await t.reset(this.toolHost);
  };

  private hasAnyEdit(): boolean {
    void this.editsTick;
    const target = this.editTargetPath();
    if (!target) return false;
    return this.tools.some((t) => t.hasEdits(target));
  }

  // --- Canvas event handlers -----------------------------------------
  private onCanvasCropChange = () => {
    this.activeTool()?.onCanvasCropChange(this.toolHost);
  };

  private onCanvasOrientationFlip = () => {
    this.activeTool()?.onCanvasOrientationFlip(this.toolHost);
  };

  private onCanvasHorizonLine = (e: Event) => {
    const ce = e as CustomEvent<number>;
    const delta = Number(ce.detail);
    if (!Number.isFinite(delta)) return;
    this.activeTool()?.onCanvasHorizonLine(this.toolHost, delta);
  };

  private fitLabel(m: ImageFit): string {
    return m === "contain" ? "None" : m === "tight" ? "Tight" : "Proof";
  }

  private sizingLabel(s: ImageSizing): string {
    return s === "fit" ? "Contain" : s === "fill" ? "Cover" : "Hybrid";
  }

  // --- Render ---------------------------------------------------------

  private renderSideRail() {
    const tabs: ReadonlyArray<{
      id: SidePanelTab;
      icon: string;
      label: string;
    }> = [
      { id: "info", icon: "info", label: "Info" },
      { id: "edit", icon: "pencil", label: "Edit" },
      { id: "post", icon: "wand", label: "Post Process" },
    ];
    return html`
      <div class="edit-side-rail" @click=${(e: Event) => e.stopPropagation()}>
        ${tabs.map(
          (t) => html`
            <pf-icon-button
              icon=${t.icon}
              label=${t.label}
              aria-pressed=${this.activeTab === t.id ? "true" : "false"}
              class=${this.activeTab === t.id ? "is-active" : ""}
              @click=${() => this.toggleTab(t.id)}
            ></pf-icon-button>
          `
        )}
      </div>
    `;
  }

  private renderTabContent() {
    switch (this.activeTab) {
      case "info":
        return html`<pf-info-card
          .exif=${this.exifLoader.exif}
          ?open=${true}
        ></pf-info-card>`;
      case "edit":
        return this.tools.map((t) => t.renderCard(this.toolHost));
      case "post":
        return html`<pf-post-process-card></pf-post-process-card>`;
      default:
        return null;
    }
  }

  private renderEditPanel() {
    const canCompare = this.canPreviewOriginal();
    const canRevertAll = this.hasAnyEdit();
    return html`
      <pf-edit-side-panel
        aria-label="Edit panel"
        @click=${(e: Event) => e.stopPropagation()}
        @mouseenter=${() => (this.editPanelVisible = true)}
      >
        ${this.renderTabContent()}
        <button
          slot="footer"
          type="button"
          class="footer-btn"
          aria-pressed=${this.previewOriginal}
          aria-label="Compare before and after edits"
          title="Hold to compare before / after edits"
          ?disabled=${!canCompare}
          @pointerdown=${this.startPreviewOriginal}
          @pointerup=${this.endPreviewOriginal}
          @pointercancel=${this.endPreviewOriginal}
          @pointerleave=${this.endPreviewOriginal}
        >
          <pf-icon name="compare"></pf-icon>
          <span>Before / After</span>
        </button>
        <button
          slot="footer"
          type="button"
          class="footer-btn"
          title="Revert all edits"
          aria-label="Revert all edits"
          ?disabled=${!canRevertAll}
          @click=${this.resetAllEdits}
        >
          <pf-icon name="rotate-ccw"></pf-icon>
          <span>Revert all</span>
        </button>
      </pf-edit-side-panel>
    `;
  }

  render() {
    const photo = this.currentPhoto;
    if (!photo) return html``;
    const total = this.photos.length;
    const hasPrev = this.index > 0;
    const hasNext = this.index < total - 1;
    const path = resolvedPath(photo);
    // Merge canvas overrides from the active tool over the shell's
    // defaults. Tools that aren't active contribute nothing.
    const overrides = this.activeTool()?.applyToCanvas() ?? {};
    const cropMode = overrides.cropMode ?? false;
    const cropAspect = overrides.cropAspect ?? null;
    const rotation = overrides.rotation ?? 0;
    const horizonMode = overrides.horizonMode ?? false;
    const sizing = overrides.sizing ?? this.sizing;
    return html`
      ${renderToolbar({
        photo,
        index: this.index,
        total,
        fullscreen: this.fullscreen,
        selection: currentSelection(photo),
        openMenu: this.openMenu,
        variantHasEdits: this.variantHasEdits,
        onToggleMenu: this.toggleMenu,
        onSetFormat: this.setFormat,
        onSetVariant: this.setVariant,
        onToggleFullscreen: this.toggleFullscreen,
        onClose: this.close,
      })}
      <div class="stage-row">
        <div class="stage">
          <pf-image-canvas
            .path=${path}
            .fit=${this.fit}
            .sizing=${sizing}
            .cropMode=${cropMode}
            .cropAspect=${cropAspect}
            .rotation=${rotation}
            ?horizonMode=${horizonMode}
            .previewOriginal=${this.previewOriginal}
            .editing=${this.editMode}
            .enableFullRes=${true}
            background=${this.bgCss(this.bg)}
            @crop-change=${this.onCanvasCropChange}
            @orientation-flip=${this.onCanvasOrientationFlip}
            @horizon-line=${this.onCanvasHorizonLine}
          ></pf-image-canvas>
          ${path
            ? html`<pf-rating-overlay
                class="fv-rating-overlay"
                .path=${path}
                style="--pf-rating-inset: 16px; --pf-rating-star-size: 14px; --pf-rating-label-size: 8px;"
              ></pf-rating-overlay>`
            : null}
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
            P proof · I info · C crop · B basic · F fullscreen · G grid · Esc to close
          </div>
        </div>
        ${this.editMode
          ? html`<div
              class="edit-panel-hotzone"
              aria-hidden="true"
              @mouseenter=${() => (this.editPanelVisible = true)}
            ></div>`
          : null}
        ${this.editMode ? this.renderSideRail() : null}
        ${this.editMode && this.activeTab !== null
          ? this.renderEditPanel()
          : null}
      </div>
      ${renderBottombar({
        bg: this.bg,
        fit: this.fit,
        sizing: this.sizing,
        openMenu: this.openMenu,
        bgCss: (b) => this.bgCss(b),
        bgLabel: (b) => this.bgLabel(b),
        fitLabel: (m) => this.fitLabel(m),
        sizingLabel: (s) => this.sizingLabel(s),
        onToggleMenu: this.toggleMenu,
        onSetBg: this.setBg,
        onSetFit: this.setFit,
        onSetSizing: this.setSizing,
      })}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-full-view": PfFullView;
  }
}

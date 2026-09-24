/**
 * Modal full-screen photo viewer.
 *
 * Owns:
 *   - navigation (`go`, `close`, fullscreen toggle, variant menu),
 *   - view state (frame / sizing / bg, persisted via SQLite),
 *   - the three-tab right panel (Info / Edit / Post Process),
 *   - click-to-toggle fullscreen chrome,
 *   - press-and-hold before/after preview,
 *   - the master "Revert all" affordance.
 *
 * Tool-specific state (crop frame, tone sliders, key handling, canvas
 * wiring) is delegated to the `EditTool` subclasses under `tools/`.
 * Variant resolution and EXIF loading are
 * extracted into sibling helpers so this shell stays focused on
 * orchestration and rendering.
 */
import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { invoke } from "@tauri-apps/api/core";
import { ask, message } from "@tauri-apps/plugin-dialog";
import type { Photo } from "@domain/photo";
import {
  availableVariants,
  fileForSelection,
  type PhotoFormat,
} from "@domain/photo";
import {
  reloadVariantOverrides,
  setVariantOverride,
  subscribeVariantOverrides,
} from "@services/library/variant-store";
import { getCacheSettings, subscribeCacheSettings } from "@services/settings/cache-settings";
import { applyRatingShortcut } from "@services/rating/rating-store";
import { RATING_LABEL_KEYS } from "@domain/rating";
import {
  flushPhotoEdit,
  hasEdits,
  subscribePhotoEdits,
} from "@services/edits/edits-store";
import {
  DEFAULT_VIEW_STATE,
  FRAME_SIZES,
  loadViewState,
  saveViewState,
  type BgColor,
  type FrameRadius,
  type FrameSize,
  type ProofingSize,
  type SmoothingQuality,
} from "@services/view-state/view-state-service";
import "@ui/controls/pf-icon-button";
import "@ui/controls/pf-slider";
import "@ui/icons/pf-icon";
import "@features/image-viewer/pf-image-canvas";
import "@features/rating/pf-rating-overlay";
import type {
  ImageSizing,
  PfImageCanvas,
} from "@features/image-viewer/pf-image-canvas";
import "./views/full-view/pf-info-card";
import "./views/full-view/pf-edit-side-panel";
import "@features/editor/post-panel";
import {
  getPostProcess,
  setPostProcessEnabled,
  subscribePostProcess,
} from "@services/post-process/post-process-store";
import { flushPhotoEffects, hasEffects, reloadPhotoEffects } from "@services/effects/effects-store";
import { fullViewStyles } from "./views/full-view/styles";
import {
  renderBottombar,
  renderToolbar,
  type FullViewMenu,
} from "./views/full-view/chrome";
import type { EditTool, ToolHost } from "@features/editor/tool";
import { createEditorTools, hasActiveEditorToolValues, readEditorToolValues } from "@features/editor/registry";
import { isEffectEnabled, setEffectEnabled, subscribeEffectEnabled } from "@services/effects/effect-enabled-store";
import { editorStateAdapter } from "@features/editor/adapters/store-state";
import "@ui/controls/pf-effect-toggle";
import {
  currentSelection,
  isEditableSelection,
  resolvedPath,
} from "./views/full-view/variant-selector";
import { ExifLoader } from "./views/full-view/exif-loader";
import { loadHdImage } from "@services/images/hd-image-cache";
import {
  loadSlideshowSettings,
  saveSlideshowSettings,
  SLIDESHOW_DURATIONS,
  type SlideshowSettings,
  type SlideshowTransition,
} from "@services/view-state/slideshow-settings";
import {
  buildShortcuts,
  dispatchShortcut,
  type ShortcutDef,
} from "./views/full-view/shortcuts";

type SidePanelTab = "info" | "edit" | "post" | "slideshow";

/** Module-level clipboard for cmd+c / cmd+v across photos. Each
 *  entry is keyed by tool id; the blob is whatever the tool's
 *  `serializeEdit` returned. Lives in module scope so it persists
 *  across photo navigation (which destroys/rebuilds the view) but
 *  intentionally does *not* persist across app launches. */
let editClipboard: Record<string, unknown> | null = null;

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
  private proofingSize: ProofingSize = DEFAULT_VIEW_STATE.proofingSize;

  @state()
  private frameSize: FrameSize = DEFAULT_VIEW_STATE.frameSize;

  @state()
  private frameColor: BgColor = DEFAULT_VIEW_STATE.frameColor;

  @state()
  private frameRadius: FrameRadius = DEFAULT_VIEW_STATE.frameRadius;

  @state()
 private sizing: ImageSizing = DEFAULT_VIEW_STATE.sizing;

 @state()
 private smoothing: SmoothingQuality = DEFAULT_VIEW_STATE.smoothing;

  /** Suppresses the persistence side-effect during the initial hydrate. */
  private hydrated = false;
  private chromeObserver: ResizeObserver | null = null;

  firstUpdated(): void {
    const toolbar = this.renderRoot.querySelector<HTMLElement>(".toolbar-wrap");
    const footer = this.renderRoot.querySelector<HTMLElement>(".bottombar-wrap");
    if (!toolbar || !footer) return;
    this.chromeObserver = new ResizeObserver(() => {
      this.style.setProperty("--pf-fv-toolbar-height", `${toolbar.getBoundingClientRect().height}px`);
      this.style.setProperty("--pf-fv-footer-height", `${footer.getBoundingClientRect().height}px`);
    });
    this.chromeObserver.observe(toolbar);
    this.chromeObserver.observe(footer);
  }

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
  private unsubscribePostProcess: (() => void) | null = null;
  private unsubscribeEffectEnabled: (() => void) | null = null;
  private unsubscribeCacheSettings: (() => void) | null = null;

  @state()
  private fullResolutionEnabled = getCacheSettings().full_resolution_enabled;

  /** Fullscreen chrome is controlled explicitly by clicking/tapping the
   * image. All controls share this one state; there is no idle timer. */
  @property({ type: Boolean, reflect: true, attribute: "controls-hidden" })
  controlsHidden = false;

 /** Reflects whether the panel content (any tab) is expanded.
  *  Equivalent to `activeTab !== null`. */
  @property({ type: Boolean, reflect: true, attribute: "edit-panel-open" })
  editPanelOpen = false;

  /** Active side-panel tab, or null if the panel is collapsed. */
  @state()
  private activeTab: SidePanelTab | null = null;

  @state()
  private slideshowSettings: SlideshowSettings = loadSlideshowSettings();

  @state()
  private customDuration = !SLIDESHOW_DURATIONS.some((duration) => duration === this.slideshowSettings.durationSeconds);

  @property({ type: Boolean, reflect: true })
  private presenting = false;
  get presentationActive(): boolean {
    return this.presenting;
  }
  private slideTimer: number | null = null;
  private preloadAbort: AbortController | null = null;
  private transitionPath: string | null = null;

  /** Press-and-hold preview of the original (un-edited) image. */
  @state()
  private previewOriginal = false;

  @state()
  private savingVariant = false;

  @state()
  private deletingVariant = false;

  @state()
  private deletingPhoto = false;

  @state()
  private openingIn = false;

  @state()
  private openingRaw = false;

  // --- Edit tools ----------------------------------------------------
  private readonly tools: EditTool[] = createEditorTools("photo", editorStateAdapter);
 /** The tool currently in foreground/interactive mode. Crop is the
  *  only one that takes over the canvas; tone runs passively. */
 @state()
  private activeToolId: string | null = null;

  private exifLoader = new ExifLoader(() => this.requestUpdate());

  /** Only JPEG selections can be edited. */
  private get editMode(): boolean {
    return isEditableSelection(this.currentPhoto);
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
      setActiveTool: (toolId: string | null) => {
        host.activeToolId = toolId;
      },
    };
  }

  private onKeyDown = (e: KeyboardEvent) => this.handleKey(e);

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
    window.addEventListener("click", this.onDocClick, { capture: true });
    this.unsubscribeStore = subscribeVariantOverrides(() => {
      this.variantTick++;
    });
    this.unsubscribeEdits = subscribePhotoEdits(() => {
      this.editsTick++;
    });
    // Reflect global post-process toggle in the footer label.
    this.unsubscribePostProcess = subscribePostProcess(() => {
      this.requestUpdate();
    });
    this.unsubscribeEffectEnabled = subscribeEffectEnabled(() => this.requestUpdate());
    this.unsubscribeCacheSettings = subscribeCacheSettings((settings) => {
      this.fullResolutionEnabled = settings.full_resolution_enabled;
    });
    this.tabIndex = -1;
    queueMicrotask(() => this.focus());
    void this.hydrateViewState();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stopPresentation();
    this.chromeObserver?.disconnect();
    this.chromeObserver = null;
    this.unsubscribeEffectEnabled?.();
    this.unsubscribeEffectEnabled = null;
    this.exifLoader.syncToPath(null);
    const t = this.editTargetPath();
    if (t) void flushPhotoEdit(t);
    window.removeEventListener("keydown", this.onKeyDown, {
      capture: true,
    } as unknown as EventListenerOptions);
    window.removeEventListener("click", this.onDocClick, {
      capture: true,
    } as unknown as EventListenerOptions);
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.unsubscribeEdits?.();
    this.unsubscribeEdits = null;
    this.unsubscribePostProcess?.();
    this.unsubscribePostProcess = null;
    this.unsubscribeCacheSettings?.();
    this.unsubscribeCacheSettings = null;
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
      (changed.has("bg") || changed.has("proofingSize") || changed.has("frameSize") || changed.has("frameColor") ||
        changed.has("frameRadius") || changed.has("sizing") || changed.has("smoothing")) &&
      this.hydrated
    ) {
      void saveViewState({
        bg: this.bg,
        proofingSize: this.proofingSize,
        frameSize: this.frameSize,
        frameColor: this.frameColor,
        frameRadius: this.frameRadius,
        sizing: this.sizing,
        smoothing: this.smoothing,
      });
    }
    if (changed.has("fullscreen")) {
      if (!this.fullscreen) {
        this.stopPresentation();
        this.controlsHidden = false;
      }
      requestAnimationFrame(() => this.canvasEl()?.resetView());
    }
    if (changed.has("photos") || changed.has("index")) {
      if (this.presenting && (changed.has("photos") || (changed.has("index") && this.transitionPath !== this.editTargetPath()))) {
        this.stopPresentation();
      }
      const prevTarget = this.editTargetPath();
      if (prevTarget) void flushPhotoEdit(prevTarget);
      // Navigating cancels any active tool (crop hijack). Tool state
      // was already flushed above; we just close the canvas takeover.
      if (this.activeToolId) {
        this.activeTool()?.deactivate(this.toolHost);
        this.activeToolId = null;
      }
      this.previewOriginal = false;
      if (!this.editMode && (this.activeTab === "edit" || this.activeTab === "post")) {
        this.activeTab = null;
        this.editPanelOpen = false;
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

  private bgCss(bg: BgColor): string {
    return bg === "black" ? "#000" : bg === "white" ? "#fff" : "#808080";
  }

  /** Read the persisted view preferences from SQLite. */
  private async hydrateViewState() {
    const persisted = await loadViewState();
    if (persisted.bg) this.bg = persisted.bg;
    if (persisted.proofingSize !== undefined) this.proofingSize = persisted.proofingSize;
    if (persisted.frameSize !== undefined) this.frameSize = persisted.frameSize;
    if (persisted.frameColor) this.frameColor = persisted.frameColor;
    if (persisted.frameRadius !== undefined) this.frameRadius = persisted.frameRadius;
    if (persisted.sizing) this.sizing = persisted.sizing;
   if (persisted.smoothing) this.smoothing = persisted.smoothing;
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

  refreshPhotoSource(path: string): void {
    if (this.currentPhoto?.path === path) this.canvasEl()?.reloadSource();
  }

  private activeTool(): EditTool | null {
    return this.tools.find((t) => t.id === this.activeToolId) ?? null;
  }

  private tool(id: string): EditTool | null {
    return this.tools.find((tool) => tool.id === id) ?? null;
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
    // Text-entry controls own their keystrokes. In particular, preset names
    // must not trigger edit shortcuts or rating labels while being typed.
    const origin = e.composedPath()[0];
    if (
      origin instanceof HTMLInputElement ||
      origin instanceof HTMLTextAreaElement ||
      origin instanceof HTMLSelectElement ||
      (origin instanceof HTMLElement && origin.isContentEditable)
    ) {
      return;
    }
    if (e.code === "Space") return;
    if (this.presenting) {
      if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey &&
          (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        this.go(e.key === "ArrowRight" ? 1 : -1);
      }
      return;
    }
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
    // Cmd/Ctrl + C / V: copy/paste edits across photos. Every tool
    // contributes its own serialized blob (returns null if it has
    // nothing to copy) so new tools opt in automatically.
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
      const k = e.key.toLowerCase();
      if (k === "c") {
        const target = this.toolHost.editTarget;
        if (target) {
          const snap: Record<string, unknown> = {};
          for (const t of this.tools) {
            const data = t.serializeEdit(target);
            if (data !== null) snap[t.id] = data;
          }
          editClipboard = snap;
          e.preventDefault();
        }
        return;
      }
      if (k === "v") {
        if (editClipboard && this.toolHost.editTarget) {
          for (const t of this.tools) {
            if (t.id in editClipboard) {
              void t.applyEdit(this.toolHost, editClipboard[t.id]);
            }
          }
          this.requestUpdate();
          e.preventDefault();
        }
        return;
      }
    }
    if (dispatchShortcut(e, this.shortcuts, this, this.editMode)) return;
    if (RATING_LABEL_KEYS.has(e.key)) {
      const photo = this.currentPhoto;
      if (photo) {
        e.preventDefault();
        applyRatingShortcut(photo.path, e.key);
      }
    }
  }

  private readonly shortcuts: readonly ShortcutDef[] = buildShortcuts();

  /** Called via the shortcuts registry (P). */
  cycleFrameSize() {
    const idx = FRAME_SIZES.indexOf(this.frameSize);
    this.frameSize = FRAME_SIZES[(idx + 1) % FRAME_SIZES.length];
    this.openMenu = null;
  }

  private go(delta: number, automatic = false) {
    const next = this.index + delta;
    if (next < 0 || next >= this.photos.length) return;
    if (this.presenting && !automatic) {
      if (this.slideTimer !== null) window.clearTimeout(this.slideTimer);
      this.slideTimer = null;
      this.preloadAbort?.abort();
      this.preloadAbort = null;
      this.captureSlide();
      this.transitionPath = resolvedPath(this.photos[next]);
    }
    this.dispatchEvent(
      new CustomEvent("full-view-navigate", {
        detail: { index: next },
        bubbles: true,
        composed: true,
      })
    );
  }

  private updateSlideshowSettings(change: Partial<SlideshowSettings>) {
    this.slideshowSettings = { ...this.slideshowSettings, ...change };
    saveSlideshowSettings(this.slideshowSettings);
  }

  private onSlideshowDurationChange = (event: Event) => {
    const value = (event.target as HTMLSelectElement).value;
    this.customDuration = value === "custom";
    if (!this.customDuration) this.updateSlideshowSettings({ durationSeconds: Number(value) });
  };

  private onCustomDurationChange = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const seconds = Number(input.value);
    if (Number.isInteger(seconds) && seconds >= 1 && seconds <= 86400) {
      this.updateSlideshowSettings({ durationSeconds: seconds });
    } else {
      input.value = String(this.slideshowSettings.durationSeconds);
    }
  };

  private requestPresentation = () => {
    this.dispatchEvent(new CustomEvent("slideshow-start", { bubbles: true, composed: true }));
  };

  startPresentation(): void {
    if (this.presenting || !this.currentPhoto) return;
    this.presenting = true;
    this.controlsHidden = true;
    this.openMenu = null;
    this.notifyControlsVisibility();
    if (this.canvasEl()?.imageReady) this.scheduleNextSlide();
  }

  stopPresentation(): void {
    if (!this.presenting) return;
    this.presenting = false;
    if (this.slideTimer !== null) window.clearTimeout(this.slideTimer);
    this.slideTimer = null;
    this.preloadAbort?.abort();
    this.preloadAbort = null;
    this.transitionPath = null;
    const overlay = this.renderRoot.querySelector<HTMLCanvasElement>(".slideshow-overlay");
    if (overlay) overlay.style.display = "none";
    this.controlsHidden = false;
    this.notifyControlsVisibility();
  }

  private scheduleNextSlide(): void {
    if (!this.presenting) return;
    if (this.index >= this.photos.length - 1) {
      this.slideTimer = window.setTimeout(() => {
        this.slideTimer = null;
        this.stopPresentation();
      }, this.slideshowSettings.durationSeconds * 1000);
      return;
    }
    const next = this.photos[this.index + 1];
    const path = resolvedPath(next);
    if (!path) {
      this.stopPresentation();
      return;
    }
    const abort = new AbortController();
    this.preloadAbort = abort;
    const preload = loadHdImage(path, { signal: abort.signal }).catch((error: unknown) => {
      if (!abort.signal.aborted) console.warn("Slideshow preload failed", error);
    });
    this.slideTimer = window.setTimeout(async () => {
      this.slideTimer = null;
      await preload;
      if (!this.presenting || abort.signal.aborted || this.preloadAbort !== abort) return;
      this.preloadAbort = null;
      this.captureSlide();
      this.transitionPath = path;
      this.go(1, true);
    }, this.slideshowSettings.durationSeconds * 1000);
  }

  private captureSlide(): void {
    const source = this.canvasEl()?.renderRoot.querySelector("canvas");
    const overlay = this.renderRoot.querySelector<HTMLCanvasElement>(".slideshow-overlay");
    if (!source || !overlay) return;
    if (overlay.style.display !== "block" || overlay.style.opacity !== "1") {
      overlay.width = source.width;
      overlay.height = source.height;
      overlay.getContext("2d")?.drawImage(source, 0, 0);
    }
    overlay.style.transition = "none";
    overlay.style.opacity = "1";
    overlay.style.display = "block";
  }

  private onSlideImageReady = (event: CustomEvent<{ path: string }>) => {
    if (!this.presenting || event.detail.path !== this.editTargetPath()) return;
    if (this.transitionPath === event.detail.path) {
      this.transitionPath = null;
      const overlay = this.renderRoot.querySelector<HTMLCanvasElement>(".slideshow-overlay");
      if (overlay) {
        if (this.slideshowSettings.transition === "instant") {
          overlay.style.display = "none";
        } else {
          requestAnimationFrame(() => {
            if (!this.presenting) return;
            overlay.style.transition = "opacity 500ms ease";
            overlay.style.opacity = "0";
          });
        }
      }
    }
    if (this.slideTimer === null && this.preloadAbort === null) this.scheduleNextSlide();
  };

  private onSlideImageError = (event: CustomEvent<{ path: string }>) => {
    if (this.presenting && event.detail.path === this.editTargetPath()) this.stopPresentation();
  };

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

  private isIPad(): boolean {
    const ua = navigator.userAgent ?? "";
    return /iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  }

  private onImageActivate = () => {
    if (this.presenting) {
      this.stopPresentation();
      return;
    }
    if (!this.fullscreen) return;
    this.controlsHidden = !this.controlsHidden;
    this.openMenu = null;
    this.notifyControlsVisibility();
  };

  private notifyControlsVisibility(): void {
    this.dispatchEvent(new CustomEvent("full-view-controls-visibility", {
      detail: { hidden: this.controlsHidden },
      bubbles: true,
      composed: true,
    }));
  }

  private onImageDoubleActivate = (event: Event) => {
    if (this.presenting) {
      this.stopPresentation();
      return;
    }
    // Desktop keeps the established double-click 100%↔fit action. On iPad a
    // double-tap toggles the app-level immersive viewer; native iOS window
    // fullscreen cannot be exited programmatically.
    if (!this.isIPad()) return;
    event.preventDefault();
    this.toggleFullscreen();
  };

  private onImageSwipe = (event: CustomEvent<{ delta: number }>) => {
    this.go(event.detail.delta);
  };

  private setBg = (bg: BgColor) => {
    this.bg = bg;
    this.openMenu = null;
  };

  private setProofingSize = (size: ProofingSize) => {
    const same = this.proofingSize === size;
    this.proofingSize = size;
    if (same) this.canvasEl()?.resetView();
  };

  private setFrameSize = (size: FrameSize) => {
    const same = this.frameSize === size;
    this.frameSize = size;
    if (same) this.canvasEl()?.resetView();
  };

  private setFrameColor = (color: BgColor) => {
    this.frameColor = color;
  };

  private setFrameRadius = (radius: FrameRadius) => {
    this.frameRadius = radius;
  };

  private setSizing = (s: ImageSizing) => {
    const same = this.sizing === s;
    this.sizing = s;
    if (same) this.canvasEl()?.resetView();
 };

 private setSmoothing = (q: SmoothingQuality) => {
  this.smoothing = q;
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
    return path != null && (hasEdits(path) || hasEffects(path));
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

  /** Crop tool: takes over the canvas. Also reached via shortcut C. */
  toggleTool(tool: EditTool) {
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

  toggleToolById(id: string) {
    const tool = this.tool(id);
    if (tool) this.toggleTool(tool);
  }

  /** Tone card: passive, no canvas takeover. Shortcut B. */
  toggleToneCard() {
    this.openTab("edit");
    const tool = this.tool("tone");
    if (tool) tool.cardOpen = !tool.cardOpen;
    this.requestUpdate();
  }

  /**
   * Per-photo tone curve (shortcut `U`). Passive: the canvas reads
   * the curve from the edits store via its own subscription.
   */
  toggleCurveCard() {
    this.openTab("edit");
    const tool = this.tool("curve");
    if (tool) tool.cardOpen = !tool.cardOpen;
    this.requestUpdate();
  }

  /**
   * Per-photo color (HSL) shortcut (`H`).
   */
  toggleColorCard() {
    this.openTab("edit");
    const tool = this.tool("color");
    if (tool) tool.cardOpen = !tool.cardOpen;
    this.requestUpdate();
  }

  /**
   * Shortcut handler for the post-process tone-curve tool (`M`).
   * Routing-only: the cards in the post panel are always expanded
   * and wired straight to `post-process-store`.
   */
  togglePostCurveCard() {
    this.openTab("post");
    this.requestUpdate();
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

  private onImagePreviewStart = () => { this.previewOriginal = true; };
  private onImagePreviewEnd = () => { this.previewOriginal = false; };

  private canPreviewOriginal(): boolean {
    void this.editsTick;
    const target = this.editTargetPath();
    return !!target && (
      hasEdits(target) || hasEffects(target) ||
      (getPostProcess().enabled && hasActiveEditorToolValues(readEditorToolValues("post", target, editorStateAdapter)))
    );
  }

  /** Ensure a newly-set busy state reaches the screen before an expensive
   * image or filesystem operation starts on the next frame. */
  private async paintBusyState(): Promise<void> {
    await this.updateComplete;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  }

  private saveVariant = async () => {
    if (this.savingVariant || this.deletingVariant || this.deletingPhoto) return;
    const photo = this.currentPhoto;
    const selection = photo ? currentSelection(photo) : null;
    const sourcePath = this.editTargetPath();
    const canvas = this.canvasEl();
    if (!photo || !selection || !sourcePath || !canvas) return;

    this.savingVariant = true;
    try {
      // Let WebKit paint the busy state before full-resolution rendering and
      // JPEG encoding occupy the main thread.
      await this.paintBusyState();
      let number = 1;
      let variant = "Edit";
      let overwrite = false;

      while (await invoke<boolean>("photo_variant_exists", {
        photoPath: sourcePath,
        variant,
      })) {
        const next = number === 1 ? "Edit 2" : `Edit ${number + 1}`;
        overwrite = await ask(
          `${variant}.jpg already exists. Overwrite it? Choose No to save as ${next}.`,
          { title: "Save Variant", kind: "warning" },
        );
        if (overwrite) {
          break;
        }
        number += 1;
        variant = `Edit ${number}`;
      }

      await flushPhotoEdit(sourcePath);
      const jpegBytes = await canvas.exportJpeg();
      await invoke("save_photo_variant", jpegBytes, {
        headers: {
          "photo-path": encodeURIComponent(sourcePath),
          variant: encodeURIComponent(variant),
          overwrite: String(overwrite),
        },
      });
      setVariantOverride(photo.path, {
        format: "jpg",
        variant,
      });
      await this.dispatchCatalogChange("save", photo);
    } catch (error) {
      console.error("Failed to save photo variant", error);
      void message(`Failed to save variant: ${error}`, {
        title: "Save Variant",
        kind: "error",
      });
    } finally {
      this.savingVariant = false;
      this.requestUpdate();
    }
  };

  private preferredRemainingSelection(
    photo: Photo,
    removedFormat: PhotoFormat,
    removedVariant: string,
  ): { format: PhotoFormat; variant: string } | null {
    const jpg = availableVariants(photo, "jpg").filter(
      (variant) => removedFormat !== "jpg" || variant.key !== removedVariant,
    );
    if (jpg.length > 0) {
      const edits = jpg
        .filter((variant) => /^edit(?: \d+)?$/i.test(variant.key))
        .sort((a, b) => {
          const number = (key: string) =>
            key.toLowerCase() === "edit" ? 1 : Number(key.slice(5));
          return number(b.key) - number(a.key);
        });
      return { format: "jpg", variant: edits[0]?.key ?? jpg[0].key };
    }
    return null;
  }

  private deleteVariant = async () => {
    if (this.deletingVariant || this.savingVariant || this.deletingPhoto) return;
    const photo = this.currentPhoto;
    const selection = photo ? currentSelection(photo) : null;
    const sourcePath = this.editTargetPath();
    if (!photo || !selection || !sourcePath) return;

    const confirmed = await ask(
      `Move the current image (${selection.format.toUpperCase()}, ${selection.variant}) to the Bin?`,
      { title: "Delete Variant", kind: "warning" },
    );
    if (!confirmed) return;

    this.deletingVariant = true;
    try {
      await this.paintBusyState();
      await flushPhotoEffects();
      await invoke("trash_photo_variant", { photoPath: sourcePath });
      await Promise.all([reloadPhotoEffects(), reloadVariantOverrides()]);
      const fallback = this.preferredRemainingSelection(
        photo,
        selection.format,
        selection.variant,
      );
      if (fallback && photo.path !== sourcePath) setVariantOverride(photo.path, fallback);
      const hasRemainingFiles = photo.files?.some((file) => file.path !== sourcePath) ?? false;
      await this.dispatchCatalogChange(
        hasRemainingFiles ? "variant-delete" : "photo-delete",
        photo,
      );
    } catch (error) {
      console.error("Failed to delete photo variant", error);
      void message(`Failed to delete variant: ${error}`, {
        title: "Delete Variant",
        kind: "error",
      });
    } finally {
      this.deletingVariant = false;
    }
  };

  /** Called from both the toolbar button and Delete/Backspace shortcut. */
  deletePhoto = async () => {
    if (this.deletingPhoto || this.savingVariant || this.deletingVariant) return;
    const photo = this.currentPhoto;
    if (!photo) return;
    const confirmed = await ask(
      `Move ${photo.filename} and all its variants to the Bin?`,
      { title: "Delete Photo", kind: "warning" },
    );
    if (!confirmed) return;

    this.deletingPhoto = true;
    this.openMenu = null;
    try {
      await this.paintBusyState();
      await flushPhotoEffects();
      await invoke("trash_photo_group", { photoPath: photo.path });
      await Promise.all([reloadPhotoEffects(), reloadVariantOverrides()]);
      await this.dispatchCatalogChange("photo-delete", photo);
    } catch (error) {
      console.error("Failed to delete photo", error);
      void message(`Failed to delete photo: ${error}`, {
        title: "Delete Photo",
        kind: "error",
      });
    } finally {
      this.deletingPhoto = false;
    }
  };

  private openIn = async () => {
    if (this.openingIn) return;
    const path = this.editTargetPath();
    if (!path) return;
    this.openingIn = true;
    this.openMenu = null;
    try {
      await invoke("open_photo_in_app", { path });
    } catch (error) {
      console.error("Failed to open photo in another app", error);
      void message(`Failed to open photo: ${error}`, {
        title: "Open In",
        kind: "error",
      });
    } finally {
      this.openingIn = false;
    }
  };

  private openRaw = async (path: string) => {
    if (this.openingRaw) return;
    this.openingRaw = true;
    this.openMenu = null;
    try {
      await invoke("open_raw_in_default_app", { path });
    } catch (error) {
      console.error("Failed to open RAW photo", error);
      void message(`Failed to open RAW photo: ${error}`, {
        title: "Open RAW",
        kind: "error",
      });
    } finally {
      this.openingRaw = false;
    }
  };

  private dispatchCatalogChange(
    kind: "save" | "variant-delete" | "photo-delete",
    photo: Photo,
  ): Promise<void> {
    const memberPaths = photo.files?.map((file) => file.path) ?? [photo.path];
    let completion = Promise.resolve();
    this.dispatchEvent(
      new CustomEvent("photo-catalog-changed", {
        detail: {
          kind,
          photoPath: photo.path,
          memberPaths,
          previousIndex: this.index,
          waitUntil: (operation: Promise<void>) => {
            completion = operation;
          },
        },
        bubbles: true,
        composed: true,
      }),
    );
    return completion;
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
    { id: "slideshow", icon: "play", label: "Slideshow" },
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
      case "edit": {
        const path = this.editTargetPath();
        const enabled = isEffectEnabled("photo", path, "all");
        return html`
          <div class="edit-enable-row">
            <span>Edit ${enabled ? "enabled" : "disabled"}</span>
            <pf-effect-toggle
              .disabled=${!enabled}
              label="editing"
              @effect-toggle=${() => setEffectEnabled("photo", path, "all", !enabled)}
            ></pf-effect-toggle>
          </div>
          <div class=${enabled ? "edit-tool-stack" : "edit-tool-stack dim"}>
            ${this.tools.map((tool) => tool.renderCard(this.toolHost))}
          </div>`;
      }
     case "post":
        return html`<pf-post-process-card></pf-post-process-card>`;
      case "slideshow":
        return html`<section class="slideshow-settings">
          <h2>Slideshow</h2>
          <label for="slide-duration">Time per photo</label>
          <span class="slideshow-select-wrap">
            <select id="slide-duration" @change=${this.onSlideshowDurationChange}>
              ${SLIDESHOW_DURATIONS.map((seconds) => html`<option value=${seconds}
                ?selected=${!this.customDuration && this.slideshowSettings.durationSeconds === seconds}>
                ${seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${seconds / 60}min` : "1h"}
              </option>`)}
              <option value="custom" ?selected=${this.customDuration}>Custom</option>
            </select>
            <pf-icon name="chevron-down"></pf-icon>
          </span>
          ${this.customDuration ? html`<label for="slide-custom-duration">Seconds per photo</label>
            <input id="slide-custom-duration" type="number" min="1" max="86400" step="1"
              .value=${String(this.slideshowSettings.durationSeconds)} @change=${this.onCustomDurationChange} />` : null}
          <label for="slide-transition">Transition</label>
          <span class="slideshow-select-wrap">
            <select id="slide-transition"
              @change=${(event: Event) => this.updateSlideshowSettings({ transition: (event.target as HTMLSelectElement).value as SlideshowTransition })}>
              <option value="fade" ?selected=${this.slideshowSettings.transition === "fade"}>Fade</option>
              <option value="instant" ?selected=${this.slideshowSettings.transition === "instant"}>Instant</option>
            </select>
            <pf-icon name="chevron-down"></pf-icon>
          </span>
          <button type="button" @click=${this.requestPresentation}><pf-icon name="play"></pf-icon> Play</button>
        </section>`;
      default:
        return null;
    }
  }

  private renderEditPanel() {
    return html`
     <pf-edit-side-panel
       aria-label="Edit panel"
       @click=${(e: Event) => e.stopPropagation()}
     >
        ${this.renderTabContent()}
        ${this.activeTab === "edit" ? this.renderEditTabFooter() : null}
      </pf-edit-side-panel>
    `;
  }

  /** Footer for the editing tab only: comparison/reset above file actions.
   *  Hidden on Info and Post-Process tabs. */
  private renderEditTabFooter() {
    const canCompare = this.canPreviewOriginal();
    const canRevertAll = this.hasAnyEdit();
    return html`
      <div slot="footer" class="edit-footer">
        <div class="edit-footer-row">
          <button
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
        </div>
        <div class="edit-footer-row">
          <button
            type="button"
            class="footer-btn"
            aria-label=${this.savingVariant
              ? "Saving edited image as a variant"
              : "Save edited image as a variant"}
            aria-busy=${this.savingVariant ? "true" : "false"}
            title="Save edited image as a JPEG variant"
            ?disabled=${this.savingVariant || this.deletingVariant || this.deletingPhoto}
            @click=${this.saveVariant}
          >
            ${this.savingVariant
              ? html`<span class="footer-btn-spinner" aria-hidden="true"></span>`
              : html`<pf-icon name="save"></pf-icon>`}
            <span>${this.savingVariant ? "Saving…" : "Save Variant"}</span>
          </button>
          <button
            type="button"
            class="footer-btn danger"
            aria-label=${this.deletingVariant
              ? "Deleting current image"
              : "Delete current image"}
            aria-busy=${this.deletingVariant ? "true" : "false"}
            title="Move current image to the Bin"
            ?disabled=${this.savingVariant || this.deletingVariant || this.deletingPhoto}
            @click=${this.deleteVariant}
          >
            ${this.deletingVariant
              ? html`<span class="footer-btn-spinner" aria-hidden="true"></span>`
              : html`<pf-icon name="trash"></pf-icon>`}
            <span>${this.deletingVariant ? "Deleting…" : "Delete Variant"}</span>
          </button>
        </div>
      </div>
    `;
  }

  render() {
    const photo = this.currentPhoto;
    if (!photo) return html``;
    const total = this.photos.length;
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
     <div class="toolbar-wrap">
       ${renderToolbar({
       photo,
       index: this.index,
       total,
       fullscreen: this.fullscreen,
       selection: currentSelection(photo),
       openMenu: this.openMenu,
       variantHasEdits: this.variantHasEdits,
       onToggleMenu: this.toggleMenu,
      onOpenRaw: this.openRaw,
       onSetVariant: this.setVariant,
       onDeletePhoto: this.deletePhoto,
       onOpenIn: this.openIn,
       deletingPhoto: this.deletingPhoto,
       fileActionBusy: this.savingVariant || this.deletingVariant,
       openingIn: this.openingIn,
      openingRaw: this.openingRaw,
       showFullscreenToggle: !this.isIPad(),
       onToggleFullscreen: this.toggleFullscreen,
       onClose: this.close,
     })}
     </div>
     <div class="stage-row">
        <div class="stage">
          <pf-image-canvas
            .path=${path}
            ?presenting=${this.presenting}
            .proofingSize=${this.proofingSize}
            .frameSize=${this.frameSize}
            .frameColor=${this.bgCss(this.frameColor)}
            .frameRadius=${this.frameRadius}
            .sizing=${sizing}
           .smoothingQuality=${this.smoothing}
           .cropMode=${cropMode}
            .cropAspect=${cropAspect}
            .rotation=${rotation}
            ?horizonMode=${horizonMode}
            .previewOriginal=${this.previewOriginal}
            .editing=${this.editMode}
            .enableFullRes=${this.fullResolutionEnabled}
            background=${this.bgCss(this.bg)}
            @crop-change=${this.onCanvasCropChange}
            @orientation-flip=${this.onCanvasOrientationFlip}
            @horizon-line=${this.onCanvasHorizonLine}
            @image-activate=${this.onImageActivate}
            @image-double-activate=${this.onImageDoubleActivate}
            @image-swipe=${this.onImageSwipe}
            @image-ready=${this.onSlideImageReady}
            @image-error=${this.onSlideImageError}
            @image-preview-start=${this.onImagePreviewStart}
            @image-preview-end=${this.onImagePreviewEnd}
          ></pf-image-canvas>
          <canvas class="slideshow-overlay" aria-hidden="true"
            @transitionend=${(event: TransitionEvent) => { (event.target as HTMLCanvasElement).style.display = "none"; }}></canvas>
          ${path
            ? html`<pf-rating-overlay
                class="fv-rating-overlay"
                .path=${path}
                ?fullscreen=${true}
                ?forceVisible=${!this.fullscreen || !this.controlsHidden}
                style="--pf-rating-inset: 16px; --pf-rating-star-size: 14px; --pf-rating-label-size: 8px;"
              ></pf-rating-overlay>`
            : null}
        </div>
        ${!this.presenting
      ? this.renderSideRail() : null}
      ${!this.presenting && this.activeTab !== null
          ? this.renderEditPanel()
          : null}
      </div>
     <div class="bottombar-wrap">
       ${renderBottombar({
      bg: this.bg,
      proofingSize: this.proofingSize,
      frameSize: this.frameSize,
      frameColor: this.frameColor,
      frameRadius: this.frameRadius,
       sizing: this.sizing,
       smoothing: this.smoothing,
       openMenu: this.openMenu,
       bgCss: (b) => this.bgCss(b),
       bgLabel: (b) => this.bgLabel(b),
       onToggleMenu: this.toggleMenu,
       onSetBg: this.setBg,
      onSetProofingSize: this.setProofingSize,
      onSetFrameSize: this.setFrameSize,
      onSetFrameColor: this.setFrameColor,
      onSetFrameRadius: this.setFrameRadius,
       onSetSizing: this.setSizing,
       onSetSmoothing: this.setSmoothing,
       postProcessEnabled: getPostProcess().enabled,
      onPlaySlideshow: this.requestPresentation,
        onTogglePostProcess: () =>
          setPostProcessEnabled(!getPostProcess().enabled),
     })}
     </div>
   `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-full-view": PfFullView;
  }
}

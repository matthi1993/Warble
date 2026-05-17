import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Folder } from "@domain/folder";
import type { Photo } from "@domain/photo";
import { buildFolderForest } from "./folder-tree";
import { loadVariantOverrides } from "./variant-store";
import { RATING_LABEL_KEYS } from "@domain/rating";
import {
  applyRatingShortcut,
  loadPhotoRatings,
} from "@services/rating/rating-store";
import {
  clearThumbnailBatch,
  dropAllThumbnailState,
  getThumbnailProgress,
  onThumbnailProgress,
  startThumbnailBatch,
  type ThumbnailBatchProgress,
} from "./thumbnail-service";
import { prewarmHdImageBytesForFolder } from "./hd-image-cache";
import {
  getHdPrewarmProgress,
  onHdPrewarmProgress,
  type HdPrewarmProgress,
} from "./hd-image-cache";
import "./photo-grid";
import "./detail-panel";
import "./full-view";

function findFolderByPath(roots: Folder[], path: string): Folder | null {
  for (const r of roots) {
    if (r.path === path) return r;
    const child = findFolderByPath(r.children, path);
    if (child) return child;
  }
  return null;
}

@customElement("warble-app")
export class WarbleApp extends LitElement {
  static styles = css`
    :host {
      display: grid;
      grid-template-rows: 1fr auto;
      grid-template-columns: 32px 228px 1fr 380px;
      grid-template-areas:
        "rail sidebar main detail"
        "footer footer footer footer";
      height: 100vh;
      background: var(--pf-bg);
      color: var(--pf-text);
      font-family: var(--pf-font-sans);
      font-size: var(--pf-text-base);
    }
    :host(.sidebar-collapsed) {
      grid-template-columns: 32px 0 1fr 380px;
    }
    :host(.sidebar-collapsed) aside.sidebar {
      display: none;
    }

    /* Permanent left-rail that always reserves room for the sidebar
       toggle. Keeping this column in the grid — even when the
       sidebar itself is collapsed — prevents the toggle from
       overlapping the main content (e.g. the photo filename in the
       full view's toolbar). */
    .sidebar-rail {
      grid-area: rail;
      border-right: 1px solid var(--pf-border);
      background: var(--pf-surface);
      display: flex;
      flex-direction: column;
      align-items: center;
      padding-top: var(--pf-space-2);
      box-sizing: border-box;
    }

    aside.sidebar {
      grid-area: sidebar;
      border-right: 1px solid var(--pf-border);
      background: var(--pf-surface);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .sidebar-header {
      padding: var(--pf-space-3);
      border-bottom: 1px solid var(--pf-border);
      display: flex;
      align-items: center;
      gap: var(--pf-space-2);
    }
    .sidebar-header pf-button {
      flex: 1 1 auto;
      min-width: 0;
    }
    .sidebar-header .header-actions {
      display: inline-flex;
      align-items: center;
      gap: var(--pf-space-1);
      flex: 0 0 auto;
    }
    .tree {
      flex: 1;
      overflow-y: auto;
      padding: var(--pf-space-2);
    }
    .empty {
      color: var(--pf-text-subtle);
      font-size: var(--pf-text-sm);
      padding: var(--pf-space-2);
    }

    main.content {
      grid-area: main;
      margin: var(--pf-space-4);
      overflow-y: auto;
    }
    h1 {
      margin: 0 0 var(--pf-space-4);
      font-size: var(--pf-text-xl);
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    p {
      color: var(--pf-text-muted);
      font-size: var(--pf-text-sm);
    }

    aside.detail {
      grid-area: detail;
      border-left: 1px solid var(--pf-border);
      overflow: hidden;
    }

    pf-full-view {
      grid-row: 1;
      grid-column: 3 / -1;
      min-width: 0;
      min-height: 0;
    }

    footer.app-footer {
      grid-area: footer;
      display: flex;
      align-items: center;
      gap: var(--pf-space-3);
      padding: var(--pf-space-2) var(--pf-space-4);
      border-top: 1px solid var(--pf-border);
      background: var(--pf-surface);
      color: var(--pf-text-muted);
      font-size: var(--pf-text-xs);
      min-height: 32px;
    }
    .footer-label {
      flex-shrink: 0;
    }
    .footer-bar {
      flex: 1;
      height: 4px;
      background: var(--pf-surface-2);
      border-radius: 999px;
      overflow: hidden;
      max-width: 320px;
    }
    .footer-bar-fill {
      height: 100%;
      background: var(--pf-accent);
      transition: width 120ms ease-out;
    }
    .footer-count {
      flex-shrink: 0;
      font-variant-numeric: tabular-nums;
    }
    .footer-failed {
      color: var(--pf-danger);
    }
    .footer-spacer {
      flex: 1;
    }
    .footer-restart {
      flex-shrink: 0;
      margin-left: auto;
    }

    .ctx-menu-backdrop {
      position: fixed;
      inset: 0;
      z-index: 1000;
    }
    .ctx-menu {
      position: fixed;
      min-width: 180px;
      background: var(--pf-surface);
      color: var(--pf-text);
      border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-md);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
      padding: var(--pf-space-1);
      font-size: var(--pf-text-sm);
      z-index: 1001;
    }
    .ctx-menu button {
      display: block;
      width: 100%;
      text-align: left;
      background: transparent;
      color: inherit;
      border: 0;
      padding: var(--pf-space-2) var(--pf-space-3);
      border-radius: var(--pf-radius-sm);
      font: inherit;
      cursor: pointer;
    }
    .ctx-menu button:hover,
    .ctx-menu button:focus-visible {
      background: var(--pf-surface-2);
      outline: none;
    }
  `;

  @state()
  private imports: Folder[] = [];

  @state()
  private photos: Photo[] = [];

  @state()
  private selectedFolderId: string | null = null;

  @state()
  private selectedFolderName: string | null = null;

  @state()
  private selectedPhoto: Photo | null = null;

  @state()
  private fullViewIndex: number | null = null;

  @state()
  private sidebarCollapsed = false;

  /** Whether the right-side edit panel is expanded in windowed mode.
   * Mirrors `pf-full-view`'s `editPanelOpenWindowed` and is persisted
   * across sessions. */
  @state()
  private editPanelOpen = false;



  /** Mirror of the OS window's fullscreen state. Toggled by the `f`
   * shortcut and the maximize buttons in the detail panel and full
   * view. Drives `pf-full-view`'s overlay styling. */
  @state()
  private windowFullscreen = false;

  @state()
  private thumbProgress: ThumbnailBatchProgress = getThumbnailProgress();

  @state()
  private hdProgress: HdPrewarmProgress = getHdPrewarmProgress();

  @state()
  private contextMenu: {
    path: string;
    filename: string;
    x: number;
    y: number;
  } | null = null;

  private unsubscribeProgress: (() => void) | null = null;
  private unsubscribeHdProgress: (() => void) | null = null;
  private unsubscribeCacheCleared: UnlistenFn | null = null;

  /** Active HD-image disk-cache prewarm for the currently selected
   * folder. Replaced (and the previous one cancelled) every time the
   * user picks a new folder or restarts the thumbnail batch, so we
   * never accumulate background HD jobs across folders. */
  private hdPrewarmHandle: { cancel(): void } | null = null;
  /** Batch id of the most recent thumbnail batch we kicked off HD
   * prewarm for. Prevents firing prewarm twice for the same batch as
   * progress events stream in. */
  private hdPrewarmedBatchId: number = 0;

  /** Suppresses the persistence side-effect during the initial restore
   * pass so we don't immediately write back what we just read. */
  private appViewHydrated = false;

  private get folders(): Folder[] {
    return buildFolderForest(this.imports);
  }

  async connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.onGlobalKey);
    this.unsubscribeProgress = onThumbnailProgress((state) => {
      this.thumbProgress = state;
      this.maybeStartHdPrewarm(state);
    });
    this.unsubscribeHdProgress = onHdPrewarmProgress((state) => {
      this.hdProgress = state;
    });
    // Menu-driven "Clear Thumbnail Cache" wipes the disk cache; here we
    // also drop the renderer-side base64 LRU and re-issue the active
    // batch so on-screen cards re-decode from source.
    void listen<string>("cache-cleared", (event) => {
      if (event.payload === "thumbnail_disk") {
        this.refreshAfterThumbnailCacheClear();
      }
    }).then((unlisten) => {
      this.unsubscribeCacheCleared = unlisten;
    });
    try {
      const persisted = await invoke<Folder[]>("list_imported_folders");
      if (persisted.length > 0) {
        this.imports = persisted;
      }
    } catch (err) {
      console.error("Failed to load imported folders", err);
    }

    // Hydrate per-photo variant preferences before any thumbnail or
    // detail panel asks for an effective selection.
    void loadVariantOverrides();
    void loadPhotoRatings();

    // Auto-open the folder the user had selected last session.
    try {
      const lastPath = await invoke<string | null>("get_last_folder");
      if (lastPath) {
        const folder = findFolderByPath(this.folders, lastPath);
        if (folder) {
          await this.selectFolder(folder.id, folder.path);
        }
      }
    } catch (err) {
      console.error("Failed to restore last folder", err);
    }

    // Restore the photo + surface (grid vs full view) the user had open.
    // Runs AFTER the folder restore so `this.photos` is populated.
    try {
      const persisted = await invoke<{
        path?: string | null;
        view?: string | null;
        sidebarCollapsed?: boolean | null;
        editPanelOpen?: boolean | null;
      } | null>("get_app_view");
      if (persisted) {
        if (typeof persisted.sidebarCollapsed === "boolean") {
          this.sidebarCollapsed = persisted.sidebarCollapsed;
        }
        if (typeof persisted.editPanelOpen === "boolean") {
          this.editPanelOpen = persisted.editPanelOpen;
        }
        if (persisted.path) {
          const idx = this.photos.findIndex((p) => p.path === persisted.path);
          if (idx >= 0) {
            this.selectedPhoto = this.photos[idx];
            if (persisted.view === "full") {
              this.fullViewIndex = idx;
            }
          }
        }
      }
    } catch (err) {
      console.error("Failed to restore last view", err);
    } finally {
      this.appViewHydrated = true;
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onGlobalKey);
    this.unsubscribeProgress?.();
    this.unsubscribeProgress = null;
    this.unsubscribeHdProgress?.();
    this.unsubscribeHdProgress = null;
    this.unsubscribeCacheCleared?.();
    this.unsubscribeCacheCleared = null;
    this.hdPrewarmHandle?.cancel();
    this.hdPrewarmHandle = null;
    clearThumbnailBatch();
  }

  /**
   * Once the active thumbnail batch has finished running every job,
   * kick off a folder-wide HD-image disk-cache prewarm at background
   * priority. Idempotent across progress events for the same batch
   * (we only fire it once per `batchId`) and cancels itself
   * automatically when the user switches folders (which starts a new
   * batch and thus advances `batchId`).
   */
  private maybeStartHdPrewarm(state: ThumbnailBatchProgress): void {
    if (state.batchId === 0) return;
    if (state.inProgress) return;
    if (state.batchId === this.hdPrewarmedBatchId) return;
    if (this.photos.length === 0) return;
    this.hdPrewarmedBatchId = state.batchId;
    this.hdPrewarmHandle?.cancel();
    this.hdPrewarmHandle = prewarmHdImageBytesForFolder(
      this.photos.map((p) => p.path)
    );
  }

  private refreshAfterThumbnailCacheClear(): void {
    dropAllThumbnailState();
    // Force every thumbnail card to forget its current image and
    // re-request via the empty cache. Re-keying photos by reassigning a
    // fresh array makes Lit's `repeat` rerun, but identity-stable keys
    // would short-circuit; instead we walk the live cards and reset
    // them.
    const grid = this.renderRoot.querySelector(
      "pf-photo-grid"
    ) as import("./photo-grid").PfPhotoGrid | null;
    grid?.renderRoot
      .querySelectorAll("pf-thumbnail-card")
      .forEach((card) => {
        (card as HTMLElement & { reload?: () => void }).reload?.();
      });
    if (this.photos.length > 0) {
      startThumbnailBatch(this.photos.map((p) => p.path));
    }
  }

  /**
   * App-level keyboard shortcuts. Routes a small set of "always on" keys
   * (`f`, `g`, `Escape`) regardless of which view is active, then falls
   * through to grid-only keys when the full view is closed. The full
   * view installs its own capture-phase listener for navigation/fit/bg
   * keys; we run after it on the bubble phase, so this code never
   * fights with the full view over arrow/p/b/0/1/2.
   */
  private onGlobalKey = (e: KeyboardEvent) => {
    // Ignore when typing in inputs/contenteditable.
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable)
    ) {
      return;
    }

    // `f` toggles window fullscreen from any view.
    if (e.key === "f" || e.key === "F") {
      e.preventDefault();
      void this.toggleWindowFullscreen();
      return;
    }

    // `Esc` always returns to the most recent non-fullscreen view:
    //   - if the OS window is fullscreen → exit fullscreen first
    //     (whatever view we were in stays put)
    //   - else if the full view is open → close it back to the grid
    //   - else → no-op
    if (e.key === "Escape") {
      if (this.contextMenu) {
        e.preventDefault();
        e.stopPropagation();
        this.contextMenu = null;
        return;
      }
      if (this.windowFullscreen) {
        e.preventDefault();
        e.stopPropagation();
        void this.setWindowFullscreen(false);
        return;
      }
      if (this.fullViewIndex !== null) {
        e.preventDefault();
        e.stopPropagation();
        this.onFullViewClose();
        return;
      }
      return;
    }

    // `g` toggles between grid and full-image view.
    if (e.key === "g" || e.key === "G") {
      if (this.fullViewIndex !== null) {
        e.preventDefault();
        this.onFullViewClose();
        return;
      }
      const idx = this.selectedPhoto
        ? this.photos.findIndex((p) => p.path === this.selectedPhoto!.path)
        : 0;
      if (idx >= 0 && idx < this.photos.length) {
        e.preventDefault();
        this.selectedPhoto = this.photos[idx];
        this.fullViewIndex = idx;
      }
      return;
    }

    // While the full view is open, let it handle its own remaining keys.
    if (this.fullViewIndex !== null) return;

    // Star ratings (1–5) and color labels (6–9, 0). Apply to the
    // currently-selected grid photo, falling back to the first card
    // if nothing is selected yet.
    if (RATING_LABEL_KEYS.has(e.key)) {
      const target =
        this.selectedPhoto ?? (this.photos.length > 0 ? this.photos[0] : null);
      if (target) {
        e.preventDefault();
        applyRatingShortcut(target.path, e.key);
      }
      return;
    }

    if (
      e.key === "ArrowLeft" ||
      e.key === "ArrowRight" ||
      e.key === "ArrowUp" ||
      e.key === "ArrowDown"
    ) {
      const grid = this.renderRoot.querySelector(
        "pf-photo-grid"
      ) as import("./photo-grid").PfPhotoGrid | null;
      if (!grid) return;
      const dx = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
      const dy = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
      if (grid.moveSelection(dx, dy)) e.preventDefault();
      return;
    }

    if (e.key === "Enter") {
      const grid = this.renderRoot.querySelector(
        "pf-photo-grid"
      ) as import("./photo-grid").PfPhotoGrid | null;
      if (grid && this.selectedPhoto) {
        e.preventDefault();
        grid.openSelected();
      }
    }
  };

  private async setWindowFullscreen(enable: boolean) {
    try {
      await getCurrentWindow().setFullscreen(enable);
      this.windowFullscreen = enable;
    } catch (err) {
      console.error("setFullscreen failed", err);
      return;
    }
    // Exiting fullscreen on macOS sometimes leaves the webview without
    // keyboard focus, which silently breaks every shortcut until the
    // user clicks back into the window. Force focus back to the Tauri
    // window AND to this element so the global keydown listener keeps
    // firing.
    if (!enable) {
      try {
        await getCurrentWindow().setFocus();
      } catch (err) {
        console.warn("setFocus failed", err);
      }
      // Defer until after the OS animation settles.
      window.setTimeout(() => {
        this.tabIndex = -1;
        this.focus();
      }, 50);
    }
  }

  private toggleWindowFullscreen = async () => {
    await this.setWindowFullscreen(!this.windowFullscreen);
  };

  private onToggleFullscreenRequest = () => {
    void this.toggleWindowFullscreen();
  };

  private async importFolder() {
    const paths = await invoke<string[]>("select_folders_dialog");
    if (!paths || paths.length === 0) return;
    const trees = await Promise.all(
      paths.map((path) => invoke<Folder>("import_folder", { path }))
    );
    this.imports = [...this.imports, ...trees];
  }

  /** Re-walk every imported root from disk. The Rust side clears its
   *  in-memory catalog and rescans each previously imported root. We
   *  then re-fetch the photo list for whatever folder is currently
   *  open so files added on disk show up immediately. */
  private async refreshFolders() {
    try {
      const trees = await invoke<Folder[]>("refresh_imported_folders");
      this.imports = trees;
    } catch (err) {
      console.error("Failed to refresh imported folders", err);
      return;
    }
    if (this.selectedFolderId && this.selectedFolderId !== null) {
      try {
        const path = this.selectedFolderId;
        this.photos = await invoke<Photo[]>("get_photos_in_folder", {
          folderPath: path,
        });
        startThumbnailBatch(this.photos.map((p) => p.path));
      } catch (err) {
        console.error("Failed to refresh active folder", err);
      }
    }
  }

  private async onFolderSelect(
    e: CustomEvent<{ id: string; path: string }>
  ) {
    const { id, path } = e.detail;
    await this.selectFolder(id, path);
  }

  private async selectFolder(id: string, path: string) {
    this.selectedFolderId = id;
    const name = id.split("/").filter(Boolean).pop() ?? path;
    this.selectedFolderName = name;
    this.photos = await invoke<Photo[]>("get_photos_in_folder", {
      folderPath: path,
    });
    this.selectedPhoto = null;
    // Cancel any in-flight HD prewarm for the previous folder so its
    // background jobs don't keep running once the user has moved on.
    this.hdPrewarmHandle?.cancel();
    this.hdPrewarmHandle = null;
    startThumbnailBatch(this.photos.map((p) => p.path));
    void invoke("set_last_folder", { path }).catch((err) =>
      console.error("Failed to persist last folder", err)
    );
  }

  private onPhotoSelected(
    e: CustomEvent<{ path: string; filename: string }>
  ) {
    this.selectedPhoto = {
      path: e.detail.path,
      filename: e.detail.filename,
    };
  }

  private onPhotoOpen(
    e: CustomEvent<{ path: string; filename: string }>
  ) {
    const idx = this.photos.findIndex((p) => p.path === e.detail.path);
    if (idx >= 0) {
      this.selectedPhoto = this.photos[idx];
      this.fullViewIndex = idx;
    }
  }

  private onPhotoContextMenu(
    e: CustomEvent<{ path: string; filename: string; x: number; y: number }>
  ) {
    this.contextMenu = { ...e.detail };
  }

  private dismissContextMenu = () => {
    if (this.contextMenu) this.contextMenu = null;
  };

  private async revealInFileManager(path: string) {
    this.contextMenu = null;
    try {
      await invoke("reveal_in_file_manager", { path });
    } catch (err) {
      console.error("reveal_in_file_manager failed", err);
    }
  }

  private revealLabel(): string {
    const ua =
      typeof navigator !== "undefined" ? navigator.userAgent ?? "" : "";
    if (/Mac|iPhone|iPad/i.test(ua)) return "Show in Finder";
    if (/Win/i.test(ua)) return "Show in Explorer";
    return "Show in File Manager";
  }

  private onFullViewNavigate(e: CustomEvent<{ index: number }>) {
    const idx = e.detail.index;
    if (idx < 0 || idx >= this.photos.length) return;
    this.fullViewIndex = idx;
    this.selectedPhoto = this.photos[idx];
  }

  private onFullViewClose = () => {
    this.fullViewIndex = null;
  };

  private onEditPanelOpenChanged = (e: CustomEvent<{ open: boolean }>) => {
    this.editPanelOpen = e.detail.open;
  };

  private toggleSidebar = () => {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  };

  updated(changed: Map<string, unknown>): void {
    if (changed.has("sidebarCollapsed")) {
      this.classList.toggle("sidebar-collapsed", this.sidebarCollapsed);
    }
    if (changed.has("windowFullscreen") || changed.has("fullViewIndex")) {
      // In fullscreen with the full view open the folder sidebar is
      // hidden entirely (no hover-to-reveal). Keep `full-view-open`
      // for the windowed-mode chrome alignment.
      this.classList.toggle("full-view-open", this.fullViewIndex !== null);
    }
    if (
      this.appViewHydrated &&
      (changed.has("selectedPhoto") ||
        changed.has("fullViewIndex") ||
        changed.has("sidebarCollapsed") ||
        changed.has("editPanelOpen"))
    ) {
      void this.persistAppView();
    }
  }

  private async persistAppView() {
    try {
      await invoke("set_app_view", {
        view: {
          path: this.selectedPhoto?.path ?? null,
          view: this.fullViewIndex !== null ? "full" : "grid",
          sidebarCollapsed: this.sidebarCollapsed,
          editPanelOpen: this.editPanelOpen,
        },
      });
    } catch (err) {
      console.warn("Failed to persist app view", err);
    }
  }

  render() {
    return html`
      <div class="sidebar-rail">
        <pf-icon-button
          icon=${this.sidebarCollapsed ? "panel-left-open" : "panel-left-close"}
          label=${this.sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          @click=${this.toggleSidebar}
        ></pf-icon-button>
      </div>

      <aside class="sidebar">
        <div class="sidebar-header">
          <pf-button variant="primary" @click=${() => this.importFolder()}>
            <pf-icon name="folder-plus"></pf-icon>
            Add Folders
          </pf-button>
          <span class="header-actions">
            <pf-icon-button
              icon="refresh"
              label="Refresh folders"
              @click=${() => this.refreshFolders()}
            ></pf-icon-button>
            <pf-theme-toggle></pf-theme-toggle>
          </span>
        </div>
        <div class="tree" @folder-select=${this.onFolderSelect}>
          ${this.folders.length === 0
            ? html`<div class="empty">No folders imported yet.</div>`
            : this.folders.map(
                (f) => html`
                  <pf-folder-tree-item
                    .folder=${f}
                    is-root
                    selected-id=${this.selectedFolderId ?? ""}
                  ></pf-folder-tree-item>
                `
              )}
        </div>
      </aside>

      <main
        class="content"
        @photo-selected=${this.onPhotoSelected}
        @photo-open=${this.onPhotoOpen}
        @photo-context-menu=${this.onPhotoContextMenu}
      >
        ${this.selectedFolderId === null
          ? html`<h1>Warble</h1>
              <p>Select a folder from the sidebar to view its photos.</p>`
          : this.photos.length === 0
          ? html`<h1>${this.selectedFolderName ?? ""}</h1>
              <p>No photos in this folder.</p>`
          : html`<pf-photo-grid
              .photos=${this.photos}
              .selectedPath=${this.selectedPhoto?.path ?? null}
              .folderName=${this.selectedFolderName ?? ""}
              ?full-view-open=${this.fullViewIndex !== null}
            ></pf-photo-grid>`}
      </main>

      <aside
        class="detail"
        @photo-open=${this.onPhotoOpen}
        @toggle-window-fullscreen=${this.onToggleFullscreenRequest}
      >
        <pf-detail-panel
          .photo=${this.selectedPhoto}
          ?fullViewOpen=${this.fullViewIndex !== null}
          ?windowFullscreen=${this.windowFullscreen}
        ></pf-detail-panel>
      </aside>

      ${this.fullViewIndex !== null
        ? html`<pf-full-view
            .photos=${this.photos}
            .index=${this.fullViewIndex}
            ?fullscreen=${this.windowFullscreen}
            .editPanelOpenWindowed=${this.editPanelOpen}
            @full-view-navigate=${this.onFullViewNavigate}
            @full-view-close=${this.onFullViewClose}
            @edit-panel-open-changed=${this.onEditPanelOpenChanged}
            @toggle-window-fullscreen=${this.onToggleFullscreenRequest}
          ></pf-full-view>`
        : null}

      ${this.renderFooter()}
      ${this.renderContextMenu()}
      <pf-debug-overlay></pf-debug-overlay>
    `;
  }

  private renderContextMenu() {
    const cm = this.contextMenu;
    if (!cm) return null;
    return html`
      <div
        class="ctx-menu-backdrop"
        @click=${this.dismissContextMenu}
        @contextmenu=${(e: MouseEvent) => {
          e.preventDefault();
          this.dismissContextMenu();
        }}
      ></div>
      <div
        class="ctx-menu"
        role="menu"
        style="left: ${cm.x}px; top: ${cm.y}px;"
      >
        <button
          role="menuitem"
          @click=${() => this.revealInFileManager(cm.path)}
        >
          ${this.revealLabel()}
        </button>
      </div>
    `;
  }

  private renderFooter() {
    const t = this.thumbProgress;
    const h = this.hdProgress;

    // Thumbnail batch wins as long as it's running — it's the
    // user-visible work that gates the grid showing pictures.
    if (t.total > 0 && t.inProgress) {
      const done = t.loaded + t.failed;
      const pct = t.total === 0 ? 0 : Math.round((done / t.total) * 100);
      return html`
        <footer class="app-footer" role="status" aria-live="polite">
          <span class="footer-label">Generating thumbnails…</span>
          <div class="footer-bar">
            <div class="footer-bar-fill" style="width: ${pct}%"></div>
          </div>
          <span class="footer-count">${done} / ${t.total}</span>
          ${t.failed > 0
            ? html`<span class="footer-failed">${t.failed} failed</span>`
            : null}
          ${this.renderRestartButton()}
        </footer>
      `;
    }

    // Once thumbnails are done, surface the HD-disk-cache prewarm
    // progress in the same slot. Same visual treatment, different
    // label, so the user knows there's still background work
    // happening (and roughly how far along it is) without it being
    // mistaken for a stalled grid.
    if (h.total > 0 && h.inProgress) {
      const done = h.loaded + h.failed;
      const pct = h.total === 0 ? 0 : Math.round((done / h.total) * 100);
      return html`
        <footer class="app-footer" role="status" aria-live="polite">
          <span class="footer-label">Building HD cache…</span>
          <div class="footer-bar">
            <div class="footer-bar-fill" style="width: ${pct}%"></div>
          </div>
          <span class="footer-count">${done} / ${h.total}</span>
          ${h.failed > 0
            ? html`<span class="footer-failed">${h.failed} failed</span>`
            : null}
          ${this.renderRestartButton()}
        </footer>
      `;
    }

    return html`
      <footer class="app-footer" role="status" aria-live="polite">
        <span class="footer-label">Ready</span>
        <span class="footer-spacer"></span>
      </footer>
    `;
  }

  /** Inline icon button shown next to the active progress bar. Cancels
   * every queued + running task in the backend pool, drops the
   * frontend's batch state, and re-kicks off thumbnail generation +
   * HD prewarm for the active folder. Useful when the queue gets
   * stuck or the user wants a clean retry without changing folders. */
  private renderRestartButton() {
    if (this.photos.length === 0) return null;
    return html`
      <pf-icon-button
        class="footer-restart"
        icon="rotate-cw"
        label="Restart caching"
        @click=${this.restartCaching}
      ></pf-icon-button>
    `;
  }

  private restartCaching = async () => {
    if (this.photos.length === 0) return;
    // Stop everything in flight first: the backend pool flips every
    // CancelToken so workers bail out at their next checkpoint, then
    // the frontend forgets the current thumbnail batch + HD prewarm
    // so the next start() doesn't see stale progress.
    try {
      await invoke<number>("cancel_all_tasks");
    } catch (err) {
      console.warn("cancel_all_tasks failed", err);
    }
    this.hdPrewarmHandle?.cancel();
    this.hdPrewarmHandle = null;
    this.hdPrewarmedBatchId = 0;
    clearThumbnailBatch();
    // Re-issue the thumbnail batch. Already-cached entries return
    // instantly from the disk cache and the bar will jump near 100%
    // — that's expected: nothing remains to do for them. Anything
    // missing or invalidated since last time is what the user
    // actually wants to see refilled. `maybeStartHdPrewarm` re-fires
    // HD prewarm once thumbnails settle.
    startThumbnailBatch(this.photos.map((p) => p.path));
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "warble-app": WarbleApp;
  }
}

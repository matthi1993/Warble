import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Folder, Photo } from "./types";
import { buildFolderForest } from "./folder-tree";
import { loadVariantOverrides } from "./variant-store";
import {
  clearThumbnailBatch,
  dropAllThumbnailState,
  getThumbnailProgress,
  onThumbnailProgress,
  startThumbnailBatch,
  type ThumbnailBatchProgress,
} from "./thumbnail-service";
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
      grid-template-rows: auto 1fr auto;
      grid-template-columns: 260px 1fr 380px;
      grid-template-areas:
        "header header header"
        "sidebar main detail"
        "footer footer footer";
      height: 100vh;
      background: var(--pf-bg);
      color: var(--pf-text);
      font-family: var(--pf-font-sans);
      font-size: var(--pf-text-base);
    }
    :host(.sidebar-collapsed) {
      grid-template-columns: 0 1fr 380px;
    }
    :host(.sidebar-collapsed) aside.sidebar {
      display: none;
    }

    header.app-header {
      grid-area: header;
      display: flex;
      align-items: center;
      gap: var(--pf-space-3);
      padding: var(--pf-space-2) var(--pf-space-4);
      border-bottom: 1px solid var(--pf-border);
      background: var(--pf-surface);
      height: 28px;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: var(--pf-space-2);
      font-weight: 600;
      letter-spacing: 0.04em;
      color: var(--pf-text);
    }
    .brand-mark {
      width: 22px;
      height: 22px;
      color: var(--pf-text);
      filter: drop-shadow(0 0 0 transparent);
    }
    .header-spacer {
      flex: 1;
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
      padding: var(--pf-space-4);
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
      grid-row: 2;
      grid-column: 2 / -1;
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

  /** Mirror of the OS window's fullscreen state. Toggled by the `f`
   * shortcut and the maximize buttons in the detail panel and full
   * view. Drives `pf-full-view`'s overlay styling. */
  @state()
  private windowFullscreen = false;

  @state()
  private thumbProgress: ThumbnailBatchProgress = getThumbnailProgress();

  @state()
  private contextMenu: {
    path: string;
    filename: string;
    x: number;
    y: number;
  } | null = null;

  private unsubscribeProgress: (() => void) | null = null;
  private unsubscribeCacheCleared: UnlistenFn | null = null;

  private get folders(): Folder[] {
    return buildFolderForest(this.imports);
  }

  async connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.onGlobalKey);
    this.unsubscribeProgress = onThumbnailProgress((state) => {
      this.thumbProgress = state;
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
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onGlobalKey);
    this.unsubscribeProgress?.();
    this.unsubscribeProgress = null;
    this.unsubscribeCacheCleared?.();
    this.unsubscribeCacheCleared = null;
    clearThumbnailBatch();
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

  private toggleSidebar = () => {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  };

  updated(changed: Map<string, unknown>): void {
    if (changed.has("sidebarCollapsed")) {
      this.classList.toggle("sidebar-collapsed", this.sidebarCollapsed);
    }
  }

  render() {
    return html`
      <header class="app-header">
        <pf-icon-button
          icon=${this.sidebarCollapsed ? "panel-left-open" : "panel-left-close"}
          label=${this.sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          @click=${this.toggleSidebar}
        ></pf-icon-button>
        <span class="header-spacer"></span>
        <pf-theme-toggle></pf-theme-toggle>
      </header>

      <aside class="sidebar">
        <div class="sidebar-header">
          <pf-button variant="primary" @click=${() => this.importFolder()}>
            <pf-icon name="folder-plus"></pf-icon>
            Add Folders
          </pf-button>
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
        <h1>
          ${this.selectedFolderName
            ? `Photos in ${this.selectedFolderName}`
            : "Warble"}
        </h1>
        ${this.selectedFolderId === null
          ? html`<p>Select a folder from the sidebar to view its photos.</p>`
          : this.photos.length === 0
          ? html`<p>No photos in this folder.</p>`
          : html`<pf-photo-grid
              .photos=${this.photos}
              .selectedPath=${this.selectedPhoto?.path ?? null}
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
            @full-view-navigate=${this.onFullViewNavigate}
            @full-view-close=${this.onFullViewClose}
            @toggle-window-fullscreen=${this.onToggleFullscreenRequest}
          ></pf-full-view>`
        : null}

      ${this.renderFooter()}
      ${this.renderContextMenu()}
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
    const p = this.thumbProgress;
    const done = p.loaded + p.failed;
    const pct = p.total === 0 ? 0 : Math.round((done / p.total) * 100);
    return html`
      <footer class="app-footer" role="status" aria-live="polite">
        ${p.total === 0
          ? html`<span class="footer-label">Ready</span>
              <span class="footer-spacer"></span>`
          : html`
              <span class="footer-label">
                ${p.inProgress ? "Generating thumbnails…" : "Thumbnails ready"}
              </span>
              <div class="footer-bar">
                <div class="footer-bar-fill" style="width: ${pct}%"></div>
              </div>
              <span class="footer-count">${done} / ${p.total}</span>
              ${p.failed > 0
                ? html`<span class="footer-failed">${p.failed} failed</span>`
                : null}
            `}
      </footer>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "warble-app": WarbleApp;
  }
}

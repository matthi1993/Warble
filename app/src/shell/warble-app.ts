import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { app } from "@app/composition/app";
import "@app/views/detail";
import "@app/views/full-view";
import "@app/views/grid";
import "@app/views/settings";
import type { PfSettings } from "@app/views/settings";
import "@ui/controls/pf-icon-button";
import type { PhotoCatalogChange } from "./photo-changes-controller";
import "./pf-album-context-menu";
import "./pf-album-dialog";
import "./pf-app-footer";
import "./pf-app-sidebar";
import "./pf-busy-overlay";
import "./pf-content-topbar";
import "./pf-folder-context-menu";
import "./pf-library-placeholder";
import "./pf-photo-context-menu";
import { Shell } from "./shell";
import { ShellDom } from "./shell-dom";
import { ShellOverlaysRenderer } from "./shell-overlays-renderer";
import type { ShellChanges } from "./shell-state";
import { warbleAppStyles } from "./warble-app.styles";

type CatalogChangeEvent = CustomEvent<PhotoCatalogChange & { waitUntil?: (operation: Promise<void>) => void }>;

@customElement("warble-app")
export class WarbleApp extends LitElement {
  static styles = warbleAppStyles;

  private readonly shell = new Shell(new ShellDom(this), this, app);
  private readonly overlays = new ShellOverlaysRenderer(this.shell);

  private readonly onKeyDown = (event: KeyboardEvent) => this.shell.shortcuts.handle(event);
  private readonly onDragMove = (event: PointerEvent) => {
    if (this.shell.drag.move(event.pointerId, event.clientX, event.clientY)) event.preventDefault();
  };
  private readonly onDragEnd = (event: PointerEvent) =>
    this.shell.drag.end(event.pointerId, event.clientX, event.clientY);
  private readonly onDragCancel = (event: PointerEvent) => this.shell.drag.cancel(event.pointerId);

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("pointermove", this.onDragMove, { capture: true });
    window.addEventListener("pointerup", this.onDragEnd, { capture: true });
    window.addEventListener("pointercancel", this.onDragCancel, { capture: true });
    window.addEventListener("keydown", this.onKeyDown);
    void this.shell.start();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("pointermove", this.onDragMove, true);
    window.removeEventListener("pointerup", this.onDragEnd, true);
    window.removeEventListener("pointercancel", this.onDragCancel, true);
    this.shell.stop();
  }

  protected updated(): void {
    const changes = this.shell.state.takeChanges();
    this.syncHostClasses(changes);
    this.shell.afterUpdate(changes);
  }

  private syncHostClasses(changes: ShellChanges): void {
    const state = this.shell.state;
    const fullViewOpen = state.fullViewIndex !== null;
    if (changes.has("detailOpen")) this.classList.toggle("detail-open", state.detailOpen);
    if (changes.has("mobileSidebarOpen")) this.classList.toggle("mobile-sidebar-open", state.mobileSidebarOpen);
    if (changes.has("sidebarCollapsed")) this.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
    if (!changes.has("immersiveView") && !changes.has("fullViewIndex")) return;
    this.classList.toggle("full-view-open", fullViewOpen);
    this.classList.toggle("fs-fullview", state.immersiveView && fullViewOpen);
    if (!state.immersiveView || !fullViewOpen) this.classList.remove("fs-controls-hidden");
  }

  private onCatalogChanged(event: CatalogChangeEvent): void {
    const refresh = this.shell.photoChanges.catalogChanged(event.detail);
    event.detail.waitUntil?.(refresh);
  }

  private renderSidebar() {
    const { shell } = this;
    return html`
      <aside class="sidebar">
        <pf-app-sidebar .view=${shell.viewModel.sidebar}
          @folders-refresh=${() => shell.folders.refreshAll()}
          @all-photos-select=${() => shell.navigation.selectAllPhotos()}
          @favorites-select=${() => shell.navigation.selectFavorites()}
          @section-toggle=${(event: CustomEvent) => shell.sections.toggle(event.detail.section)}
          @settings-open=${() => void this.renderRoot.querySelector<PfSettings>("pf-settings")?.open()}
          @folder-clear=${() => shell.folderSelection.clear()}
          @add-folders=${() => shell.folders.import()}
          @folder-select=${(event: CustomEvent) =>
            shell.folderSelection.selectFromSidebar(event.detail.id, event.detail.path)}
          @root-reconnect=${(event: CustomEvent) => {
            event.stopPropagation();
            void shell.folders.reconnect(event.detail.rootId);
          }}
          @folder-context-menu=${(event: CustomEvent) => {
            event.stopPropagation();
            shell.menus.openFolderMenu(event.detail);
          }}
          @date-select=${(event: CustomEvent) => shell.navigation.selectDate(event.detail.key)}
          @album-select=${(event: CustomEvent) => shell.albums.select(event.detail.id)}
          @album-context-menu=${(event: CustomEvent) => shell.menus.openAlbumMenu(event.detail)}
          @album-create=${() => shell.albums.openDialog("new")}></pf-app-sidebar>
      </aside>
    `;
  }

  private renderContent() {
    const { state, viewModel } = this.shell;
    const kind = viewModel.contentKind;
    if (kind !== "grid") {
      return html`<pf-library-placeholder .kind=${kind} .heading=${viewModel.title}
        .message=${viewModel.emptyMessage} .showSubfolderToggle=${viewModel.showsSubfolderToggle}
        .includeSubfolders=${state.includeSubfolders}></pf-library-placeholder>`;
    }
    return html`<pf-photo-grid
      .photos=${state.photos}
      .selectedPath=${state.selectedPhoto?.path ?? null}
      .folderName=${viewModel.title}
      .showSubfolderToggle=${viewModel.showsSubfolderToggle}
      .includeSubfolders=${state.includeSubfolders}
      .filterMetadataLoading=${state.filterMetadataLoading}
      ?full-view-open=${state.fullViewIndex !== null}
    ></pf-photo-grid>`;
  }

  private renderMain() {
    const { shell } = this;
    const state = shell.state;
    return html`
      <main class="content"
        @photo-selected=${(event: CustomEvent) => shell.photoView.select(event.detail.path)}
        @photo-selection-change=${(event: CustomEvent) => shell.photoView.setGridSelection(event.detail.paths)}
        @photo-open=${(event: CustomEvent) => shell.photoView.open(event.detail.path)}
        @photo-grid-pointer-drag-start=${(event: CustomEvent) => shell.drag.start(event.detail)}
        @photo-context-menu=${(event: CustomEvent) => shell.menus.openPhotoMenu(event.detail)}
        @toggle-include-subfolders=${() => shell.folderSelection.toggleIncludeSubfolders()}>
        <pf-content-topbar .breadcrumb=${shell.viewModel.breadcrumb}
          .showDetailToggle=${state.selectedPhoto !== null} .detailOpen=${state.detailOpen}
          @sidebar-toggle=${() => shell.panels.toggleSidebar()}
          @detail-toggle=${() => shell.panels.toggleDetail()}></pf-content-topbar>
        ${this.renderContent()}
      </main>
      <aside class="detail"
        @photo-open=${(event: CustomEvent) => shell.photoView.open(event.detail.path)}
        @toggle-window-fullscreen=${() => void shell.windowControl.toggleFullscreen()}>
        <pf-detail-panel
          .photo=${state.selectedPhoto}
          .selectionPaths=${state.fullViewIndex === null ? state.gridSelectionPaths : []}
          ?fullViewOpen=${state.fullViewIndex !== null}
          ?windowFullscreen=${state.windowFullscreen}
        ></pf-detail-panel>
      </aside>
    `;
  }

  private renderFullView() {
    const { shell } = this;
    const state = shell.state;
    if (state.fullViewIndex === null) return null;
    return html`<pf-full-view
      .photos=${state.photos}
      .index=${state.fullViewIndex}
      ?immersive=${state.immersiveView}
      ?windowFullscreen=${state.windowFullscreen}
      .editPanelOpenWindowed=${state.editPanelOpen}
      @full-view-navigate=${(event: CustomEvent) => shell.photoView.navigate(event.detail.index)}
      @slideshow-start=${() => void shell.windowControl.startSlideshow()}
      @photo-catalog-changed=${this.onCatalogChanged}
      @edit-panel-open-changed=${(event: CustomEvent) => shell.photoView.setEditPanelOpen(event.detail.open)}
      @full-view-controls-visibility=${(event: CustomEvent) =>
        this.classList.toggle("fs-controls-hidden", event.detail.hidden)}
      @toggle-window-fullscreen=${() => void shell.windowControl.toggleFullscreen()}
      @toggle-immersive-view=${() => shell.windowControl.toggleImmersive()}
    ></pf-full-view>`;
  }

  render() {
    const { shell } = this;
    const state = shell.state;
    return html`
      <div class="mobile-backdrop" @click=${() => shell.panels.closeMobileSidebar()}></div>
      <div class="detail-backdrop" @click=${() => shell.panels.closeDetail()}></div>
      <div class="sidebar-rail">
        <pf-icon-button
          icon=${state.sidebarCollapsed ? "panel-left-open" : "panel-left-close"}
          label=${state.sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          @click=${() => shell.panels.toggleSidebar()}
        ></pf-icon-button>
      </div>
      ${this.renderSidebar()}
      ${this.renderMain()}
      ${this.renderFullView()}
      <footer class="app-footer" role="status" aria-live="polite">
        <pf-app-footer .mode=${state.fullViewIndex === null ? "grid" : "image"}
          .imageDisabled=${!state.photos.length}
          @view-mode-change=${(event: CustomEvent<{ mode: "grid" | "image" }>) => {
            if (event.detail.mode === "grid") shell.photoView.closeFullView();
            else shell.photoView.openSelected();
          }}></pf-app-footer>
      </footer>
      ${this.overlays.render()}
      <pf-settings @workspace-reset-starting=${() => shell.photoList.stopBackgroundWork()}></pf-settings>
      <pf-busy-overlay></pf-busy-overlay>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "warble-app": WarbleApp;
  }
}

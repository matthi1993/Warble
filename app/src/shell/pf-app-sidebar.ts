import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import "@ui/controls/pf-button";
import "@ui/controls/pf-icon-button";
import "@ui/controls/pf-theme-toggle";
import "@ui/icons/pf-icon";
import { APP_ICON_URL } from "./app-icon";
import type { SidebarView } from "./library-view-model";
import { appSidebarStyles } from "./pf-app-sidebar.styles";
import type { SidebarSection } from "./shell-fields";
import type { SidebarAlbums } from "./sidebar-albums";
import "./sidebar-albums";
import "./sidebar-days";
import "./sidebar-folders";

@customElement("pf-app-sidebar")
export class PfAppSidebar extends LitElement {
  static styles = appSidebarStyles;

  @property({ attribute: false }) view!: SidebarView;

  albumDropTarget(): SidebarAlbums | null {
    return this.renderRoot.querySelector("pf-sidebar-albums");
  }

  private emit(name: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  private renderLibraryButton(label: string, icon: string, active: boolean, count: number | null, event: string) {
    return html`
      <button type="button" class=${`nav-button ${active ? "active" : ""}`} aria-current=${active ? "page" : "false"}
        @click=${() => this.emit(event)}>
        <pf-icon name=${icon}></pf-icon>
        <span class="nav-label">${label}</span>
        <span class="nav-count">${count?.toLocaleString() ?? "…"}</span>
      </button>
    `;
  }

  private renderSectionButton(
    section: SidebarSection,
    label: string,
    icon: string,
    state: { active: boolean; current: boolean; expanded: boolean },
  ) {
    return html`
      <button type="button" class=${`nav-button ${state.active ? "active" : ""}`}
        aria-current=${state.current ? "page" : "false"}
        aria-expanded=${state.expanded} aria-controls=${`sidebar-${section}`}
        @click=${() => this.emit("section-toggle", { section })}>
        <pf-icon name=${icon}></pf-icon>
        <span class="nav-label">${label}</span>
        <pf-icon class="nav-chevron" name="chevron-down"></pf-icon>
      </button>
    `;
  }

  render() {
    const view = this.view;
    const expanded = view.expandedSections;
    const foldersCurrent = view.mode === "folders";
    const albumsCurrent = view.mode === "albums";
    return html`
      <div class="sidebar-header">
        <div class="sidebar-brand">
          <span class="sidebar-brand-name">
            <img src=${APP_ICON_URL} alt="" />
            <span>Warble</span>
          </span>
          <span class="header-actions">
            <pf-icon-button icon="refresh" label="Refresh folders"
              @click=${() => this.emit("folders-refresh")}></pf-icon-button>
            <pf-theme-toggle></pf-theme-toggle>
          </span>
        </div>
      </div>
      <nav class="sidebar-navigation" aria-label="Library views">
        ${this.renderLibraryButton("All Photos", "image", view.mode === "allPhotos", view.allCount, "all-photos-select")}
        ${this.renderLibraryButton("Favorites", "star", view.mode === "favorites", view.favoriteCount, "favorites-select")}
        ${this.renderSectionButton("folders", "Folders", "folder", {
          active: foldersCurrent && !view.albumDropMode,
          current: foldersCurrent,
          expanded: expanded.has("folders"),
        })}
        <pf-sidebar-folders id="sidebar-folders" ?hidden=${!expanded.has("folders")}
          .folders=${view.folders} .photoCounts=${view.folderPhotoCounts}
          .selectedId=${view.selectedFolderId}></pf-sidebar-folders>
        ${this.renderSectionButton("days", "Days", "calendar", {
          active: view.mode === "days",
          current: view.mode === "days",
          expanded: expanded.has("days"),
        })}
        <pf-sidebar-days id="sidebar-days" aria-label="Photos by capture date" ?hidden=${!expanded.has("days")}
          .nodes=${view.dateNodes} .selectedKey=${view.selectedDateKey} .loading=${view.datesLoading}
          .restoringCachedDates=${view.restoringCachedDates} .hasPhotos=${view.hasPhotos}></pf-sidebar-days>
        ${this.renderSectionButton("albums", "Albums", "image", {
          active: albumsCurrent || view.albumDropMode,
          current: albumsCurrent,
          expanded: expanded.has("albums") || view.albumDropMode,
        })}
        <pf-sidebar-albums id="sidebar-albums" aria-label="Albums"
          ?hidden=${!expanded.has("albums") && !view.albumDropMode}
          .albums=${view.albums} .selectedId=${view.selectedAlbumId} .active=${albumsCurrent}></pf-sidebar-albums>
      </nav>
      <div class="sidebar-footer">
        <div class="sidebar-settings">
          <pf-button @click=${() => this.emit("settings-open")}>
            <pf-icon name="settings"></pf-icon>
            Settings
          </pf-button>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-app-sidebar": PfAppSidebar;
  }
}

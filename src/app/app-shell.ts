import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { invoke } from "@tauri-apps/api/core";
import type { Folder, Photo } from "./types";
import { buildFolderForest } from "./folder-tree";
import "./photo-grid";
import "./detail-panel";

@customElement("photoflow-app")
export class PhotoflowApp extends LitElement {
  static styles = css`
    :host {
      display: grid;
      grid-template-rows: auto 1fr;
      grid-template-columns: 260px 1fr;
      grid-template-areas:
        "header header"
        "sidebar main";
      height: 100vh;
      background: var(--pf-bg);
      color: var(--pf-text);
      font-family: var(--pf-font-sans);
      font-size: var(--pf-text-base);
    }
    :host(.has-detail) {
      grid-template-columns: 260px 1fr 380px;
      grid-template-areas:
        "header header header"
        "sidebar main detail";
    }

    header.app-header {
      grid-area: header;
      display: flex;
      align-items: center;
      gap: var(--pf-space-3);
      padding: var(--pf-space-2) var(--pf-space-4);
      border-bottom: 1px solid var(--pf-border);
      background: var(--pf-surface);
      height: 48px;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: var(--pf-space-2);
      font-weight: 600;
      letter-spacing: 0.02em;
      color: var(--pf-text);
    }
    .brand .dot {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: var(--pf-accent);
      box-shadow: 0 0 0 3px var(--pf-accent-soft);
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

  private get folders(): Folder[] {
    return buildFolderForest(this.imports);
  }

  async connectedCallback() {
    super.connectedCallback();
    try {
      const persisted = await invoke<Folder[]>("list_imported_folders");
      if (persisted.length > 0) {
        this.imports = persisted;
      }
    } catch (err) {
      console.error("Failed to load imported folders", err);
    }
  }

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
    this.selectedFolderId = id;
    const name = id.split("/").filter(Boolean).pop() ?? path;
    this.selectedFolderName = name;
    this.photos = await invoke<Photo[]>("get_photos_in_folder", {
      folderPath: path,
    });
    this.selectedPhoto = null;
  }

  private onPhotoSelected(
    e: CustomEvent<{ path: string; filename: string }>
  ) {
    this.selectedPhoto = {
      path: e.detail.path,
      filename: e.detail.filename,
    };
  }

  updated(changed: Map<string, unknown>): void {
    if (changed.has("selectedPhoto")) {
      this.classList.toggle("has-detail", this.selectedPhoto !== null);
    }
  }

  render() {
    return html`
      <header class="app-header">
        <span class="brand">
          <span class="dot"></span>
          Photoflow
        </span>
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

      <main class="content" @photo-selected=${this.onPhotoSelected}>
        <h1>
          ${this.selectedFolderName
            ? `Photos in ${this.selectedFolderName}`
            : "Photoflow"}
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

      ${this.selectedPhoto
        ? html`<aside class="detail">
            <pf-detail-panel .photo=${this.selectedPhoto}></pf-detail-panel>
          </aside>`
        : null}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "photoflow-app": PhotoflowApp;
  }
}

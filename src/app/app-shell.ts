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
      grid-template-columns: 260px 1fr;
      height: 100vh;
      font-family: system-ui, sans-serif;
      color: #222;
    }
    :host(.has-detail) {
      grid-template-columns: 260px 1fr 380px;
    }
    .detail {
      border-left: 1px solid #333;
      overflow: hidden;
    }
    aside {
      border-right: 1px solid #ddd;
      background: #fafafa;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .sidebar-header {
      padding: 0.75rem;
      border-bottom: 1px solid #e5e5e5;
    }
    .tree {
      flex: 1;
      overflow-y: auto;
      padding: 0.5rem;
    }
    .empty {
      color: #888;
      font-size: 0.85rem;
      padding: 0.5rem;
    }
    main {
      padding: 1rem;
      overflow-y: auto;
    }
    h1 {
      margin: 0 0 1rem;
      font-size: 1.25rem;
    }
    ul {
      margin: 0;
      padding-left: 1.25rem;
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
      <aside>
        <div class="sidebar-header">
          <pf-button @click=${() => this.importFolder()}>Add Folders</pf-button>
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
      <main @photo-selected=${this.onPhotoSelected}>
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

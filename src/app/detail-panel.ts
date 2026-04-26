import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { invoke } from "@tauri-apps/api/core";
import type { Photo } from "./types";

@customElement("pf-detail-panel")
export class PfDetailPanel extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--pf-surface);
      color: var(--pf-text);
      overflow: hidden;
    }
    .image-wrap {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      padding: var(--pf-space-3);
      background: var(--pf-surface-2);
    }
    img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      display: block;
      border-radius: var(--pf-radius-sm);
    }
    .meta {
      padding: var(--pf-space-3) var(--pf-space-4);
      border-top: 1px solid var(--pf-border);
      font-size: var(--pf-text-sm);
      display: flex;
      flex-direction: column;
      gap: var(--pf-space-1);
    }
    .filename {
      font-weight: 600;
      font-size: var(--pf-text-base);
      word-break: break-all;
    }
    .path {
      color: var(--pf-text-muted);
      word-break: break-all;
      font-family: var(--pf-font-mono);
      font-size: var(--pf-text-xs);
    }
    .status {
      color: var(--pf-text-muted);
      font-size: var(--pf-text-sm);
    }
    .error {
      color: var(--pf-danger);
      font-size: var(--pf-text-sm);
    }
  `;

  @property({ attribute: false })
  photo: Photo | null = null;

  @state()
  private dataUrl: string | null = null;

  @state()
  private error: string | null = null;

  @state()
  private loading = false;

  private loadedPath: string | null = null;

  willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("photo")) {
      const path = this.photo?.path ?? null;
      if (path !== this.loadedPath) {
        this.dataUrl = null;
        this.error = null;
        this.loadedPath = null;
        if (path) {
          void this.load(path);
        }
      }
    }
  }

  private async load(path: string) {
    this.loading = true;
    try {
      const b64 = await invoke<string>("get_full_image", {
        photoPath: path,
      });
      if (this.photo?.path !== path) return;
      this.dataUrl = `data:image/jpeg;base64,${b64}`;
      this.loadedPath = path;
    } catch (e) {
      if (this.photo?.path !== path) return;
      this.error = String(e);
      this.loadedPath = path;
    } finally {
      if (this.photo?.path === path) {
        this.loading = false;
      }
    }
  }

  render() {
    if (!this.photo) return html``;
    return html`
      <div class="image-wrap">
        ${this.dataUrl
          ? html`<img src=${this.dataUrl} alt=${this.photo.filename} />`
          : this.error
          ? html`<div class="error">Failed to load: ${this.error}</div>`
          : html`<div class="status">
              ${this.loading ? "Loading…" : ""}
            </div>`}
      </div>
      <div class="meta">
        <div class="filename">${this.photo.filename}</div>
        <div class="path">${this.photo.path}</div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-detail-panel": PfDetailPanel;
  }
}

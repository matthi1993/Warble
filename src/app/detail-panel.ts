import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Photo } from "@domain/photo";
import {
  availableFormats,
  availableVariants,
  fileForSelection,
  primarySelection,
  type PhotoFormat,
} from "@domain/photo";
import {
  getVariantOverride,
  subscribeVariantOverrides,
} from "./variant-store";
import "../ui/controls/pf-icon-button";
import "../ui/photos/pf-image-canvas";

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
      position: relative;
      background: var(--pf-surface-2);
      padding: var(--pf-space-3);
      min-height: 0;
    }
    pf-image-canvas {
      width: 100%;
      height: 100%;
      border-radius: var(--pf-radius-sm);
      overflow: hidden;
    }
    .expand-btn {
      position: absolute;
      top: var(--pf-space-2);
      right: var(--pf-space-2);
      background: var(--pf-surface);
      border-radius: var(--pf-radius-md);
      box-shadow: var(--pf-shadow-md);
      z-index: 1;
    }
    .fullscreen-btn {
      position: absolute;
      top: var(--pf-space-2);
      right: calc(var(--pf-space-2) + 40px);
      background: var(--pf-surface);
      border-radius: var(--pf-radius-md);
      box-shadow: var(--pf-shadow-md);
      z-index: 1;
    }
    .variant-toggle {
      position: absolute;
      top: var(--pf-space-2);
      left: 50%;
      transform: translateX(-50%);
      display: inline-flex;
      align-items: center;
      gap: var(--pf-space-2);
      flex-wrap: wrap;
      z-index: 2;
    }
    .toggle-group {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 2px;
      background: var(--pf-surface);
      border: 1px solid var(--pf-border);
      box-shadow: var(--pf-shadow-md);
      border-radius: var(--pf-radius-md);
    }
    .toggle-group button {
      background: transparent;
      color: var(--pf-text);
      border: none;
      padding: 2px 8px;
      font-size: var(--pf-text-xs);
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      border-radius: var(--pf-radius-sm);
      cursor: pointer;
      white-space: nowrap;
    }
    .toggle-group button[aria-pressed="true"] {
      background: var(--pf-accent-soft);
      color: var(--pf-accent);
    }
    .menu-wrap {
      position: relative;
      display: inline-flex;
    }
    .menu-trigger {
      background: var(--pf-surface);
      color: var(--pf-text);
      border: 1px solid var(--pf-border);
      box-shadow: var(--pf-shadow-md);
      padding: 2px 8px;
      font-size: var(--pf-text-xs);
      font-weight: 600;
      border-radius: var(--pf-radius-md);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;
    }
    .menu-trigger:hover {
      background: var(--pf-accent-soft);
    }
    .menu-popup {
      position: absolute;
      top: calc(100% + 4px);
      left: 50%;
      transform: translateX(-50%);
      background: var(--pf-surface);
      border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-md);
      box-shadow: var(--pf-shadow-md);
      padding: 4px;
      z-index: 5;
      min-width: 140px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .menu-item {
      background: transparent;
      color: var(--pf-text);
      border: none;
      padding: 4px 8px;
      text-align: left;
      font-size: var(--pf-text-xs);
      border-radius: var(--pf-radius-sm);
      cursor: pointer;
    }
    .menu-item:hover {
      background: var(--pf-surface-2);
    }
    .menu-item[aria-pressed="true"] {
      background: var(--pf-accent-soft);
      color: var(--pf-accent);
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
  `;

  @property({ attribute: false })
  photo: Photo | null = null;

  @property({ type: Boolean, attribute: "fullviewopen", reflect: true })
  fullViewOpen = false;

  @property({ type: Boolean, attribute: "windowfullscreen", reflect: true })
  windowFullscreen = false;

  @state()
  private variantTick = 0;

  private unsubscribeStore: (() => void) | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribeStore = subscribeVariantOverrides(() => {
      this.variantTick++;
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
  }

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

  private currentPath(photo: Photo): string {
    const sel = this.currentSelection(photo);
    if (!sel) return photo.path;
    return fileForSelection(photo, sel.format, sel.variant) ?? photo.path;
  }

  private openFullView = () => {
    if (!this.photo) return;
    this.dispatchEvent(
      new CustomEvent("photo-open", {
        detail: { path: this.photo.path, filename: this.photo.filename },
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

  render() {
    void this.variantTick;
    const photo = this.photo;
    if (!photo) {
      return html`
        <div class="image-wrap">
          <pf-image-canvas
            .path=${null}
            fit="contain"
            background="transparent"
          ></pf-image-canvas>
        </div>
        <div class="meta">
          <div class="filename" style="color: var(--pf-text-muted); font-weight: 400;">
            No photo selected
          </div>
        </div>
      `;
    }
    const path = this.currentPath(photo);
    return html`
      <div class="image-wrap">
        <pf-image-canvas
          .path=${path}
          fit="contain"
          background="transparent"
        ></pf-image-canvas>
        ${this.fullViewOpen
          ? null
          : html`<pf-icon-button
              class="expand-btn"
              icon="expand"
              label="Open full view"
              @click=${this.openFullView}
            ></pf-icon-button>`}
        ${this.fullViewOpen
          ? null
          : html`<pf-icon-button
              class="fullscreen-btn"
              icon=${this.windowFullscreen ? "minimize" : "maximize"}
              label=${this.windowFullscreen
                ? "Exit fullscreen (F)"
                : "Enter fullscreen (F)"}
              @click=${this.toggleFullscreen}
            ></pf-icon-button>`}
      </div>
      <div class="meta">
        <div class="filename">${photo.filename}</div>
        <div class="path">${photo.path}</div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-detail-panel": PfDetailPanel;
  }
}

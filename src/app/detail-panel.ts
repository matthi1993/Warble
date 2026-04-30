import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Photo } from "./types";
import {
  availableVariants,
  primaryVariant,
  variantPath,
  type PhotoVariant,
} from "./photo-variant";
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
    .variant-toggle {
      position: absolute;
      top: var(--pf-space-2);
      left: var(--pf-space-2);
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 2px;
      background: var(--pf-surface);
      box-shadow: var(--pf-shadow-md);
      border-radius: var(--pf-radius-md);
      z-index: 1;
    }
    .variant-toggle button {
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
    }
    .variant-toggle button[aria-pressed="true"] {
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

  /** Per-photo override of which variant (jpg/raw) to render. */
  private variantOverrides = new Map<string, PhotoVariant>();
  @state()
  private variantTick = 0;

  private currentVariant(photo: Photo): PhotoVariant | null {
    return this.variantOverrides.get(photo.path) ?? primaryVariant(photo);
  }

  private currentPath(photo: Photo): string {
    const variant = this.currentVariant(photo);
    return (variant && variantPath(photo, variant)) ?? photo.path;
  }

  private setVariant = (variant: PhotoVariant) => {
    if (!this.photo) return;
    this.variantOverrides.set(this.photo.path, variant);
    this.variantTick++;
  };

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
    const variants = availableVariants(photo);
    const activeVariant = this.currentVariant(photo);
    const path = this.currentPath(photo);
    return html`
      <div class="image-wrap">
        ${variants.length > 1
          ? html`<div class="variant-toggle" role="group" aria-label="File variant">
              ${variants.map(
                (v) => html`<button
                  aria-pressed=${activeVariant === v}
                  @click=${() => this.setVariant(v)}
                >
                  ${v}
                </button>`
              )}
            </div>`
          : null}
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

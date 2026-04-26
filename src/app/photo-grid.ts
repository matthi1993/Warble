import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import type { Photo } from "./types";
import "../ui/pf-thumbnail-card";

@customElement("pf-photo-grid")
export class PfPhotoGrid extends LitElement {
  static styles = css`
    :host {
      display: block;
      position: relative;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 0.75rem;
    }
    .status {
      position: sticky;
      bottom: 1rem;
      margin-left: auto;
      width: fit-content;
      background: #222;
      color: #fff;
      padding: 0.5rem 0.75rem;
      border-radius: 0.4rem;
      font-size: 0.8rem;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      min-width: 200px;
    }
    .status-row {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
    }
    .bar {
      height: 4px;
      background: #444;
      border-radius: 2px;
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      background: #4a9cff;
      transition: width 120ms ease-out;
    }
    .err {
      color: #ff8a8a;
    }
  `;

  @property({ attribute: false })
  photos: Photo[] = [];

  @state()
  private loaded = 0;

  @state()
  private failed = 0;

  willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("photos")) {
      this.loaded = 0;
      this.failed = 0;
    }
  }

  private onLoad = () => {
    this.loaded += 1;
  };

  private onError = () => {
    this.failed += 1;
  };

  render() {
    const total = this.photos.length;
    const done = this.loaded + this.failed;
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);
    const inProgress = total > 0 && done < total;
    return html`
      <div
        class="grid"
        @thumbnail-load=${this.onLoad}
        @thumbnail-error=${this.onError}
      >
        ${repeat(
          this.photos,
          (p) => p.path,
          (p) => html`
            <pf-thumbnail-card
              .path=${p.path}
              .filename=${p.filename}
            ></pf-thumbnail-card>
          `
        )}
      </div>
      ${total > 0
        ? html`
            <div class="status" role="status" aria-live="polite">
              <div class="status-row">
                <span>
                  ${inProgress ? "Generating thumbnails…" : "Thumbnails ready"}
                </span>
                <span>${done} / ${total}</span>
              </div>
              <div class="bar">
                <div class="bar-fill" style="width: ${pct}%"></div>
              </div>
              ${this.failed > 0
                ? html`<div class="err">${this.failed} failed</div>`
                : null}
            </div>
          `
        : null}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-photo-grid": PfPhotoGrid;
  }
}

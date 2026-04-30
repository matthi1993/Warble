import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import type { Photo } from "./types";
import "../ui/photos/pf-thumbnail-card";

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
      gap: var(--pf-space-3);
    }
    .status {
      position: sticky;
      bottom: var(--pf-space-4);
      margin-left: auto;
      width: fit-content;
      background: var(--pf-surface);
      color: var(--pf-text);
      border: 1px solid var(--pf-border);
      padding: var(--pf-space-2) var(--pf-space-3);
      border-radius: var(--pf-radius-md);
      font-size: var(--pf-text-xs);
      box-shadow: var(--pf-shadow-md);
      display: flex;
      flex-direction: column;
      gap: var(--pf-space-1);
      min-width: 220px;
    }
    .status-row {
      display: flex;
      justify-content: space-between;
      gap: var(--pf-space-4);
      color: var(--pf-text-muted);
    }
    .bar {
      height: 4px;
      background: var(--pf-surface-2);
      border-radius: 999px;
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      background: var(--pf-accent);
      transition: width 120ms ease-out;
    }
    .err {
      color: var(--pf-danger);
    }
  `;

  @property({ attribute: false })
  photos: Photo[] = [];

  @property({ type: String })
  selectedPath: string | null = null;

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

  /**
   * Move grid selection by (dx, dy) cells. Determines the column count
   * by inspecting the live thumbnail layout (cards on the same row share
   * a top coordinate within a small tolerance). Dispatches
   * `photo-selected` for the new card and scrolls it into view.
   */
  moveSelection(dx: number, dy: number): boolean {
    if (this.photos.length === 0) return false;
    const cards = Array.from(
      this.renderRoot.querySelectorAll("pf-thumbnail-card")
    ) as HTMLElement[];
    if (cards.length === 0) return false;

    // Column count: number of cards sharing the first row's top.
    const firstTop = cards[0].getBoundingClientRect().top;
    let cols = 0;
    for (const c of cards) {
      if (Math.abs(c.getBoundingClientRect().top - firstTop) < 2) cols += 1;
      else break;
    }
    if (cols < 1) cols = 1;

    let idx = this.photos.findIndex((p) => p.path === this.selectedPath);
    if (idx < 0) idx = 0;
    else idx = idx + dx + dy * cols;

    if (idx < 0) idx = 0;
    if (idx >= this.photos.length) idx = this.photos.length - 1;
    const next = this.photos[idx];
    if (!next) return false;

    this.dispatchEvent(
      new CustomEvent("photo-selected", {
        detail: { path: next.path, filename: next.filename },
        bubbles: true,
        composed: true,
      })
    );
    const card = cards[idx];
    card?.scrollIntoView({ block: "nearest", inline: "nearest" });
    return true;
  }

  /** Open the currently selected photo (or the first if none) in full view. */
  openSelected(): void {
    const photo =
      this.photos.find((p) => p.path === this.selectedPath) ?? this.photos[0];
    if (!photo) return;
    this.dispatchEvent(
      new CustomEvent("photo-open", {
        detail: { path: photo.path, filename: photo.filename },
        bubbles: true,
        composed: true,
      })
    );
  }

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
              .extensions=${p.extensions ?? []}
              ?selected=${this.selectedPath === p.path}
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

import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
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
  `;

  @property({ attribute: false })
  photos: Photo[] = [];

  @property({ type: String })
  selectedPath: string | null = null;

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
    return html`
      <div class="grid">
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
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-photo-grid": PfPhotoGrid;
  }
}

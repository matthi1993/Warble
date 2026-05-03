import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import type { Photo } from "./types";
import "../ui/photos/pf-thumbnail-card";
import "../ui/controls/pf-slider";

function variantCount(photo: Photo): number {
  const files = photo.files ?? [];
  if (files.length === 0) return 1;
  const variants = new Set<string>();
  for (const f of files) variants.add(f.variant);
  return Math.max(1, variants.size);
}

const COLUMNS_STORAGE_KEY = "pf-grid-columns";
const MIN_COLUMNS = 1;
const MAX_COLUMNS = 8;
const DEFAULT_COLUMNS = 6;

function readStoredColumns(): number {
  try {
    const raw = localStorage.getItem(COLUMNS_STORAGE_KEY);
    const n = raw == null ? NaN : Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_COLUMNS;
    return Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, Math.round(n)));
  } catch {
    return DEFAULT_COLUMNS;
  }
}

@customElement("pf-photo-grid")
export class PfPhotoGrid extends LitElement {
  static styles = css`
    :host {
      display: block;
      position: relative;
    }
    .grid-header {
      position: sticky;
      top: 0;
      z-index: 5;
      display: flex;
      align-items: center;
      gap: var(--pf-space-3);
      padding: var(--pf-space-2) var(--pf-space-1);
      margin-bottom: var(--pf-space-3);
      background: var(--pf-bg);
      border-bottom: 1px solid var(--pf-border);
    }
    :host([full-view-open]) .grid-header {
      display: none;
    }
    .grid-header .label {
      font-size: var(--pf-text-xs);
      color: var(--pf-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      flex: 0 0 auto;
    }
    .grid-header pf-slider {
      flex: 0 1 220px;
    }
    .grid-header .count {
      flex: 0 0 auto;
      font-size: var(--pf-text-xs);
      color: var(--pf-text-muted);
      font-variant-numeric: tabular-nums;
    }
    .grid-header .spacer {
      flex: 1 1 auto;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(var(--pf-grid-cols, 6), 1fr);
      gap: var(--pf-space-3);
    }
  `;

  @property({ attribute: false })
  photos: Photo[] = [];

  @property({ type: String })
  selectedPath: string | null = null;

  /** When the full image view is open the grid is hidden behind the
   * overlay; suppress the sticky size header so it doesn't peek
   * through (e.g. while the overlay is fading in). */
  @property({ type: Boolean, reflect: true, attribute: "full-view-open" })
  fullViewOpen = false;

  @state()
  private columns: number = readStoredColumns();

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

  private setColumns(n: number) {
    const clamped = Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, Math.round(n)));
    if (clamped === this.columns) return;
    this.columns = clamped;
    try {
      localStorage.setItem(COLUMNS_STORAGE_KEY, String(clamped));
    } catch {
      /* ignore quota / privacy errors */
    }
  }

  render() {
    // Slider is visually inverted: dragging right reduces column
    // count (bigger thumbnails). We pass `MIN + MAX - columns` to the
    // slider so the right edge corresponds to 1 thumbnail per row,
    // and undo the mapping in the change handler.
    const sliderValue = MIN_COLUMNS + MAX_COLUMNS - this.columns;
    return html`
      <div class="grid-header">
        <span class="label">Size</span>
        <pf-slider
          min=${MIN_COLUMNS}
          max=${MAX_COLUMNS}
          step="1"
          fill-from=${MIN_COLUMNS}
          .value=${sliderValue}
          .label=${"Thumbnails per row"}
          @change=${(e: CustomEvent<number>) =>
            this.setColumns(MIN_COLUMNS + MAX_COLUMNS - e.detail)}
        ></pf-slider>
        <span class="count">${this.columns} / row</span>
        <span class="spacer"></span>
      </div>
      <div
        class="grid"
        style=${`--pf-grid-cols: ${this.columns}`}
      >
        ${repeat(
          this.photos,
          (p) => p.path,
          (p) => html`
            <pf-thumbnail-card
              .path=${p.path}
              .filename=${p.filename}
              .extensions=${p.extensions ?? []}
              .variantCount=${variantCount(p)}
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

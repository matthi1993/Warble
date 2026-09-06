import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import type { Photo } from "@domain/photo";
import {
  COLOR_LABELS,
  LABEL_COLORS,
  LABEL_DISPLAY_NAMES,
  type ColorLabel,
} from "@domain/rating";
import {
  getPhotoRating,
  subscribePhotoRatings,
} from "@services/rating/rating-store";
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
      display: flex;
      flex-direction: column;
      position: relative;
      height: 100%;
      min-height: 0;
    }
    .grid-header {
      flex: 0 0 auto;
      z-index: 5;
      display: flex;
      flex-direction: column;
      gap: var(--pf-space-2);
      padding: var(--pf-space-3) var(--pf-space-1) var(--pf-space-2);
      margin-bottom: var(--pf-space-3);
      background: var(--pf-bg);
      border-bottom: 1px solid var(--pf-border);
    }
    .grid-scroll {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
    }
    :host([full-view-open]) .grid-header {
      display: none;
    }
    .header-row {
      display: flex;
      align-items: center;
      gap: var(--pf-space-3);
      flex-wrap: wrap;
    }
    .folder-title {
      margin: 0;
      font-size: var(--pf-text-xl);
      font-weight: 600;
      letter-spacing: -0.01em;
      color: var(--pf-text);
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
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
    .filter-row {
      display: flex;
      align-items: center;
      gap: var(--pf-space-3);
      flex-wrap: wrap;
    }
    .filter-group {
      display: inline-flex;
      align-items: center;
      gap: var(--pf-space-2);
    }
    .stars-filter {
      display: inline-flex;
      gap: 2px;
      cursor: pointer;
      user-select: none;
    }
    .stars-filter button {
      background: transparent;
      border: 0;
      color: var(--pf-text-muted);
      font-size: 14px;
      line-height: 1;
      padding: 2px 1px;
      cursor: pointer;
    }
    .stars-filter button.active {
      color: var(--pf-text);
    }
    .label-chips {
      display: inline-flex;
      gap: 4px;
    }
    .label-chips button {
      width: 16px;
      height: 16px;
      border-radius: 3px;
      border: 1px solid rgba(0, 0, 0, 0.2);
      cursor: pointer;
      padding: 0;
      opacity: 0.45;
      transition: opacity var(--pf-transition),
        transform var(--pf-transition);
    }
    .label-chips button:hover {
      opacity: 0.85;
    }
    .label-chips button.active {
      opacity: 1;
      transform: scale(1.12);
      box-shadow: 0 0 0 2px var(--pf-accent-soft, rgba(255, 255, 255, 0.2));
    }
    .filter-clear {
      background: transparent;
      border: 0;
      color: var(--pf-text-muted);
      font-size: var(--pf-text-xs);
      cursor: pointer;
      text-decoration: underline;
      padding: 2px 4px;
    }
    .filter-clear[disabled] {
      visibility: hidden;
    }
    .empty-filter {
      padding: var(--pf-space-4);
      color: var(--pf-text-muted);
      font-size: var(--pf-text-sm);
      text-align: center;
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

  @property({ type: String })
  folderName: string | null = null;

  /** When the full image view is open the grid is hidden behind the
   * overlay; suppress the sticky size header so it doesn't peek
   * through (e.g. while the overlay is fading in). */
  @property({ type: Boolean, reflect: true, attribute: "full-view-open" })
  fullViewOpen = false;

  @state()
  private columns: number = readStoredColumns();

  /** Minimum star rating to include in the visible grid. `0` means
   *  "no minimum" (all photos pass). */
  @state()
  private minStars = 0;

  /** Set of color labels currently used as a filter. Empty means
   *  "no label filter" (all photos pass). Otherwise only photos
   *  whose label is in this set are shown. */
  @state()
  private activeLabels: Set<Exclude<ColorLabel, "">> = new Set();

  /** Bumped on every rating-store change so the filter recomputes. */
  @state()
  private ratingsTick = 0;

  private unsubscribeRatings: (() => void) | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribeRatings = subscribePhotoRatings(() => {
      this.ratingsTick += 1;
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribeRatings?.();
    this.unsubscribeRatings = null;
  }

  /** Bring the currently selected card into view. Called from the
   *  app-shell when the user leaves the full image view (e.g. by
   *  pressing "g") so the grid lands on the photo they were just
   *  looking at, plus internally on first render and whenever the
   *  selection changes from outside the grid. */
  scrollSelectionIntoView(): void {
    if (!this.selectedPath) return;
    const card = this.renderRoot.querySelector(
      `pf-thumbnail-card[data-path="${CSS.escape(this.selectedPath)}"]`
    ) as HTMLElement | null;
    card?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  /** Whether the last selection change originated from a click
   *  inside the grid. Set by onClick so updated() knows to skip
   *  scrollSelectionIntoView (the card is already on screen). */
  private selectionFromClick = false;

  protected updated(changed: Map<string, unknown>): void {
    // When the full-view overlay closes the grid becomes visible
    // again; scroll the selected photo into view so the user
    // doesn't lose their place in a long folder.
    if (
      changed.has("fullViewOpen") &&
      changed.get("fullViewOpen") === true &&
      !this.fullViewOpen
    ) {
      requestAnimationFrame(() => this.scrollSelectionIntoView());
    } else if (changed.has("selectedPath") && this.selectedPath) {
      // The selection moved (e.g. arrow keys propagated from the
      // shell) — keep the focused card on screen. Skip when the
      // change came from a direct click (the card is already
      // visible and centering it would cause a jump that makes
      // double-click impossible).
      if (!this.selectionFromClick) {
        requestAnimationFrame(() => this.scrollSelectionIntoView());
      }
      this.selectionFromClick = false;
    }
  }

  protected firstUpdated(): void {
    if (this.selectedPath) {
      requestAnimationFrame(() => this.scrollSelectionIntoView());
    }
    this.addEventListener('click', this.onGridClick);
  }

  private onGridClick = (e: Event) => {
    // A click inside the grid (on a thumbnail card) selects that
    // photo. Set the flag so updated() skips scrollIntoView — the
    // clicked card is already visible and centering it would jump,
    // making double-click impossible.
    if (e.target instanceof HTMLElement && e.target.closest('pf-thumbnail-card')) {
      this.selectionFromClick = true;
    }
  };

  private get filteredPhotos(): Photo[] {
    // Keep a reactive dependency on `ratingsTick` so Lit re-renders
    // when ratings change.
    void this.ratingsTick;
    if (this.minStars === 0 && this.activeLabels.size === 0) {
      return this.photos;
    }
    return this.photos.filter((p) => {
      const r = getPhotoRating(p.path);
      if (this.minStars > 0 && r.rating < this.minStars) return false;
      if (this.activeLabels.size > 0) {
        if (r.label === "" || !this.activeLabels.has(r.label)) return false;
      }
      return true;
    });
  }

  /**
   * Move grid selection by (dx, dy) cells. Determines the column count
   * by inspecting the live thumbnail layout (cards on the same row share
   * a top coordinate within a small tolerance). Dispatches
   * `photo-selected` for the new card and scrolls it into view.
   */
  moveSelection(dx: number, dy: number): boolean {
    const visible = this.filteredPhotos;
    if (visible.length === 0) return false;
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

    let idx = visible.findIndex((p) => p.path === this.selectedPath);
    if (idx < 0) idx = 0;
    else idx = idx + dx + dy * cols;

    if (idx < 0) idx = 0;
    if (idx >= visible.length) idx = visible.length - 1;
    const next = visible[idx];
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
    const visible = this.filteredPhotos;
    const photo =
      visible.find((p) => p.path === this.selectedPath) ?? visible[0];
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

  private setMinStars(n: number) {
    this.minStars = this.minStars === n ? 0 : n;
  }

  private toggleLabelFilter(label: Exclude<ColorLabel, "">) {
    const next = new Set(this.activeLabels);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    this.activeLabels = next;
  }

  private clearFilters = () => {
    this.minStars = 0;
    this.activeLabels = new Set();
  };

  render() {
    // Slider is visually inverted: dragging right reduces column
    // count (bigger thumbnails). We pass `MIN + MAX - columns` to the
    // slider so the right edge corresponds to 1 thumbnail per row,
    // and undo the mapping in the change handler.
    const sliderValue = MIN_COLUMNS + MAX_COLUMNS - this.columns;
    const visible = this.filteredPhotos;
    const filtersActive =
      this.minStars > 0 || this.activeLabels.size > 0;
    return html`
      <div class="grid-header">
        <div class="header-row">
          <h2 class="folder-title" title=${this.folderName ?? ""}>
            ${this.folderName ?? ""}
          </h2>
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
        </div>
        <div class="filter-row">
          <span class="filter-group">
            <span class="label">Stars</span>
            <span class="stars-filter" role="radiogroup" aria-label="Filter by minimum rating">
              ${[1, 2, 3, 4, 5].map(
                (n) => html`
                  <button
                    type="button"
                    class=${n <= this.minStars ? "active" : ""}
                    role="radio"
                    aria-checked=${n === this.minStars}
                    title=${`At least ${n} star${n === 1 ? "" : "s"}`}
                    @click=${() => this.setMinStars(n)}
                  >
                    ★
                  </button>
                `
              )}
            </span>
          </span>
          <span class="filter-group">
            <span class="label">Label</span>
            <span class="label-chips" role="group" aria-label="Filter by color label">
              ${COLOR_LABELS.map(
                (lab) => html`
                  <button
                    type="button"
                    class=${this.activeLabels.has(lab) ? "active" : ""}
                    style=${`background: ${LABEL_COLORS[lab]};`}
                    title=${LABEL_DISPLAY_NAMES[lab]}
                    aria-label=${LABEL_DISPLAY_NAMES[lab]}
                    aria-pressed=${this.activeLabels.has(lab)}
                    @click=${() => this.toggleLabelFilter(lab)}
                  ></button>
                `
              )}
            </span>
          </span>
          <span class="spacer"></span>
          <span class="count">
            ${filtersActive
              ? `${visible.length} / ${this.photos.length}`
              : `${this.photos.length} photo${
                  this.photos.length === 1 ? "" : "s"
                }`}
          </span>
          <button
            type="button"
            class="filter-clear"
            ?disabled=${!filtersActive}
            @click=${this.clearFilters}
          >
            Clear filters
          </button>
        </div>
      </div>
      <div class="grid-scroll">
        ${visible.length === 0 && filtersActive
          ? html`<div class="empty-filter">
              No photos match the current filters.
            </div>`
          : html`<div
              class="grid"
              style=${`--pf-grid-cols: ${this.columns}`}
            >
              ${repeat(
                visible,
                (p) => p.path,
                (p) => html`
                  <pf-thumbnail-card
                    data-path=${p.path}
                    .path=${p.path}
                    .filename=${p.filename}
                    .extensions=${p.extensions ?? []}
                    .variantCount=${variantCount(p)}
                    ?selected=${this.selectedPath === p.path}
                  ></pf-thumbnail-card>
                `
              )}
            </div>`}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-photo-grid": PfPhotoGrid;
  }
}

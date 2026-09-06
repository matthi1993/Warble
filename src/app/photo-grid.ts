import { LitElement, css, html, type TemplateResult } from "lit";
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
const GROUP_PAGE_SIZE = 48;

interface PhotoDayGroup {
  date: string | null;
  photos: Photo[];
}

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
    .subfolder-toggle {
      display: inline-flex;
      align-items: center;
      gap: var(--pf-space-2);
      flex: 0 0 auto;
      color: var(--pf-text-muted);
      font-size: var(--pf-text-xs);
      cursor: pointer;
      user-select: none;
    }
    .subfolder-toggle input {
      margin: 0;
      accent-color: var(--pf-accent);
      cursor: pointer;
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
    .filter-panel {
      display: flex;
      flex-direction: column;
      gap: var(--pf-space-2);
      padding: var(--pf-space-2) var(--pf-space-3);
      border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-md);
      background: var(--pf-surface, var(--pf-bg));
      box-shadow: var(--pf-shadow-sm);
    }
    .filter-panel-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 22px;
    }
    .filter-summary {
      display: inline-flex;
      align-items: center;
      gap: var(--pf-space-2);
      color: var(--pf-text-muted);
      font-size: var(--pf-text-xs);
      font-variant-numeric: tabular-nums;
    }
    .filter-controls {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: var(--pf-space-2);
      align-items: end;
    }
    .filter-control {
      position: relative;
      min-width: 0;
    }
    .focal-range-label {
      color: var(--pf-text-muted);
      font-size: var(--pf-text-xs);
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    .filter-control input,
    .focal-inputs input,
    .date-inputs input {
      box-sizing: border-box;
      width: 100%;
      min-height: 28px;
      padding: 4px 8px;
      border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-sm);
      background: var(--pf-bg);
      color: var(--pf-text);
      font: inherit;
      font-size: var(--pf-text-xs);
    }
    .filter-control input::placeholder,
    .date-inputs input::placeholder {
      color: var(--pf-text-muted);
    }
    .focal-range {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .date-range {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .date-inputs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--pf-space-2);
    }
    .date-inputs input {
      min-width: 0;
    }
    .focal-inputs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--pf-space-2);
    }
    .focal-inputs input::placeholder {
      color: var(--pf-text-subtle);
    }
    .filter-options {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--pf-space-3);
    }
    .filter-group {
      display: inline-flex;
      align-items: center;
      gap: var(--pf-space-2);
    }
    .filter-group {
      color: var(--pf-text-muted);
      font-size: var(--pf-text-xs);
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
      padding: 3px 7px;
      border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-sm);
      background: transparent;
      color: var(--pf-text-muted);
      font-size: var(--pf-text-xs);
      cursor: pointer;
    }
    .filter-clear:hover:not([disabled]) {
      color: var(--pf-text);
      border-color: var(--pf-text-muted);
    }
    .filter-clear[disabled] {
      opacity: 0.4;
      cursor: default;
    }
    .empty-filter {
      padding: var(--pf-space-4);
      color: var(--pf-text-muted);
      font-size: var(--pf-text-sm);
      text-align: center;
    }
    .group-load-more {
      display: flex;
      justify-content: center;
      padding: var(--pf-space-2) 0 var(--pf-space-4);
    }
    .group-load-more button {
      padding: 4px 8px;
      border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-sm);
      background: var(--pf-surface);
      color: var(--pf-text-muted);
      font: inherit;
      font-size: var(--pf-text-xs);
      cursor: pointer;
    }
    .group-load-more button:hover {
      border-color: var(--pf-accent);
      color: var(--pf-accent-hover);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(var(--pf-grid-cols, 6), 1fr);
      gap: var(--pf-space-3);
    }
    .day-group {
      margin-bottom: var(--pf-space-5);
    }
    .day-heading {
      display: flex;
      align-items: center;
      width: 100%;
      gap: var(--pf-space-2);
      margin: 0 0 var(--pf-space-2);
      padding: var(--pf-space-2) var(--pf-space-1);
      border: 0;
      border-bottom: 1px solid var(--pf-border);
      background: transparent;
      color: var(--pf-text);
      text-align: left;
      cursor: pointer;
    }
    .day-heading:hover {
      color: var(--pf-accent);
    }
    .day-heading .day-title {
      font-size: var(--pf-text-sm);
      font-weight: 600;
    }
    .day-heading .day-count {
      color: var(--pf-text-muted);
      font-size: var(--pf-text-xs);
    }
    .day-heading .day-chevron {
      margin-left: auto;
      font-size: var(--pf-text-sm);
      transition: transform var(--pf-transition);
    }
    .day-heading[aria-expanded="false"] .day-chevron {
      transform: rotate(-90deg);
    }
    @media (max-width: 900px) {
      .filter-controls {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (max-width: 720px) {
      .filter-controls {
        grid-template-columns: 1fr;
      }
    }
  `;

  @property({ attribute: false })
  photos: Photo[] = [];

  @property({ type: String })
  selectedPath: string | null = null;

  @property({ type: String })
  folderName: string | null = null;

  @property({ type: Boolean })
  includeSubfolders = false;

  @property({ type: Boolean })
  filterMetadataLoading = false;

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

  @state()
  private cameraFilter = "";

  @state()
  private lensFilter = "";

  @state()
  private minFocalLength: number | null = null;

  @state()
  private maxFocalLength: number | null = null;

  @state()
  private startDate = "";

  @state()
  private endDate = "";

  /** Date groups are expanded by default; this set contains only the
   *  groups the user explicitly collapsed. */
  @state()
  private collapsedDays: Set<string> = new Set();

  /** Bumped on every rating-store change so the filter recomputes. */
  @state()
  private ratingsTick = 0;

  private unsubscribeRatings: (() => void) | null = null;
  private moreObserver: IntersectionObserver | null = null;
  private renderedPhotoSet = "";

  @state()
  private visibleCountByDay = new Map<string, number>();

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
    this.moreObserver?.disconnect();
    this.moreObserver = null;
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
    if (changed.has("photos")) {
      const photoSet = this.photos.map((photo) => photo.path).join("\u0000");
      if (photoSet !== this.renderedPhotoSet) {
        this.renderedPhotoSet = photoSet;
        this.collapsedDays = new Set();
        this.resetVisiblePhotoPages();
      }
    }
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
    this.observeLoadMoreControls();
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
    if (!this.filtersActive) {
      return this.photos;
    }
    return this.photos.filter((p) => {
      const r = getPhotoRating(p.path);
      if (this.minStars > 0 && r.rating < this.minStars) return false;
      if (this.activeLabels.size > 0) {
        if (r.label === "" || !this.activeLabels.has(r.label)) return false;
      }
      if (this.cameraFilter && p.filterInfo?.camera !== this.cameraFilter) {
        return false;
      }
      if (this.lensFilter && p.filterInfo?.lens !== this.lensFilter) {
        return false;
      }
      const focalLength = p.filterInfo?.focalLengthMm;
      if (
        this.minFocalLength !== null &&
        (focalLength == null || focalLength < this.minFocalLength)
      ) {
        return false;
      }
      if (
        this.maxFocalLength !== null &&
        (focalLength == null || focalLength > this.maxFocalLength)
      ) {
        return false;
      }
      if (this.startDate && (p.filterInfo?.dateTaken ?? "") < this.startDate) {
        return false;
      }
      if (this.endDate && (p.filterInfo?.dateTaken ?? "") > this.endDate) {
        return false;
      }
      return true;
    });
  }

  private get filtersActive(): boolean {
    return (
      this.minStars > 0 ||
      this.activeLabels.size > 0 ||
      this.cameraFilter !== "" ||
      this.lensFilter !== "" ||
      this.minFocalLength !== null ||
      this.maxFocalLength !== null ||
      this.startDate !== "" ||
      this.endDate !== ""
    );
  }

  private getDayGroups(photos: Photo[]): PhotoDayGroup[] {
    const groups = new Map<string, Photo[]>();
    for (const photo of photos) {
      const date = photo.filterInfo?.dateTaken ?? null;
      const key = date ?? "undated";
      const group = groups.get(key);
      if (group) group.push(photo);
      else groups.set(key, [photo]);
    }

    return [...groups.entries()]
      .map(([key, photos]) => ({ date: key === "undated" ? null : key, photos }))
      .sort((a, b) => {
        if (a.date === null) return 1;
        if (b.date === null) return -1;
        return a.date.localeCompare(b.date);
      });
  }

  private get expandedPhotos(): Photo[] {
    return this.getDayGroups(this.filteredPhotos).flatMap((group) => {
      const key = group.date ?? "undated";
      return this.collapsedDays.has(key) ? [] : group.photos;
    });
  }

  private formatDay(date: string | null): string {
    if (!date) return "Date unknown";
    const parsed = new Date(`${date}T12:00:00`);
    if (Number.isNaN(parsed.getTime())) return date;
    return new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(parsed);
  }

  private get cameraOptions(): string[] {
    return [...new Set(
      this.photos
        .map((photo) => photo.filterInfo?.camera)
        .filter((value): value is string => Boolean(value))
    )].sort((a, b) => a.localeCompare(b));
  }

  private get lensOptions(): string[] {
    return [...new Set(
      this.photos
        .map((photo) => photo.filterInfo?.lens)
        .filter((value): value is string => Boolean(value))
    )].sort((a, b) => a.localeCompare(b));
  }

  private get focalBounds(): { min: number; max: number } | null {
    const values = this.photos
      .map((photo) => photo.filterInfo?.focalLengthMm)
      .filter((value): value is number => value != null && Number.isFinite(value));
    if (values.length === 0) return null;
    return { min: Math.min(...values), max: Math.max(...values) };
  }

  /**
   * Move grid selection by (dx, dy) cells. Determines the column count
   * by inspecting the live thumbnail layout (cards on the same row share
   * a top coordinate within a small tolerance). Dispatches
   * `photo-selected` for the new card and scrolls it into view.
   */
  moveSelection(dx: number, dy: number): boolean {
    const visible = this.expandedPhotos;
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
    this.ensurePhotoIsRendered(next.path);
    requestAnimationFrame(() => {
      const card = this.renderRoot.querySelector(
        `pf-thumbnail-card[data-path="${CSS.escape(next.path)}"]`
      ) as HTMLElement | null;
      card?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    return true;
  }

  /** Open the currently selected photo (or the first if none) in full view. */
  openSelected(): void {
    const visible = this.expandedPhotos;
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
    this.resetVisiblePhotoPages();
    this.minStars = this.minStars === n ? 0 : n;
  }

  private toggleLabelFilter(label: Exclude<ColorLabel, "">) {
    const next = new Set(this.activeLabels);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    this.resetVisiblePhotoPages();
    this.activeLabels = next;
  }

  private setTextFilter(
    filter: "camera" | "lens",
    event: Event
  ): void {
    this.resetVisiblePhotoPages();
    const value = (event.target as HTMLInputElement).value;
    if (filter === "camera") this.cameraFilter = value;
    else this.lensFilter = value;
  }

  private setFocalLength(bound: "min" | "max", event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const value = raw === "" ? null : Number(raw);
    const next = Number.isFinite(value) && value !== null && value >= 0 ? value : null;
    this.resetVisiblePhotoPages();
    if (bound === "min") this.minFocalLength = next;
    else this.maxFocalLength = next;
  }

  private setDate(bound: "start" | "end", event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.resetVisiblePhotoPages();
    if (bound === "start") this.startDate = value;
    else this.endDate = value;
  }

  private toggleDay(date: string | null): void {
    const key = date ?? "undated";
    const next = new Set(this.collapsedDays);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.collapsedDays = next;
  }

  private toggleIncludeSubfolders = () => {
    this.dispatchEvent(
      new CustomEvent("toggle-include-subfolders", {
        bubbles: true,
        composed: true,
      })
    );
  };

  private clearFilters = () => {
    this.resetVisiblePhotoPages();
    this.minStars = 0;
    this.activeLabels = new Set();
    this.cameraFilter = "";
    this.lensFilter = "";
    this.minFocalLength = null;
    this.maxFocalLength = null;
    this.startDate = "";
    this.endDate = "";
  };

  private visiblePhotoCount(day: string, total: number): number {
    return Math.min(this.visibleCountByDay.get(day) ?? GROUP_PAGE_SIZE, total);
  }

  private showMoreForDay(day: string): void {
    const current = this.visibleCountByDay.get(day) ?? GROUP_PAGE_SIZE;
    this.visibleCountByDay = new Map(this.visibleCountByDay).set(
      day,
      current + GROUP_PAGE_SIZE
    );
  }

  private resetVisiblePhotoPages(): void {
    this.visibleCountByDay = new Map();
  }

  private ensurePhotoIsRendered(path: string): void {
    for (const group of this.getDayGroups(this.filteredPhotos)) {
      const index = group.photos.findIndex((photo) => photo.path === path);
      if (index < 0) continue;
      const day = group.date ?? "undated";
      const current = this.visiblePhotoCount(day, group.photos.length);
      if (index >= current) {
        this.visibleCountByDay = new Map(this.visibleCountByDay).set(
          day,
          index + GROUP_PAGE_SIZE
        );
      }
      return;
    }
  }

  private observeLoadMoreControls(): void {
    this.moreObserver?.disconnect();
    const root = this.renderRoot.querySelector(".grid-scroll");
    if (!root) return;
    this.moreObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const day = (entry.target as HTMLElement).dataset.day;
          if (day) this.showMoreForDay(day);
        }
      },
      { root, rootMargin: "400px 0px" }
    );
    this.renderRoot
      .querySelectorAll<HTMLElement>(".group-load-more")
      .forEach((control) => this.moreObserver?.observe(control));
  }

  private renderPhotoCards(photos: Photo[]): TemplateResult {
    return html`<div
      class="grid"
      style=${`--pf-grid-cols: ${this.columns}`}
    >
      ${repeat(
        photos,
        (photo) => photo.path,
        (photo) => html`
          <pf-thumbnail-card
            data-path=${photo.path}
            .path=${photo.path}
            .filename=${photo.filename}
            .extensions=${photo.extensions ?? []}
            .variantCount=${variantCount(photo)}
            ?selected=${this.selectedPath === photo.path}
          ></pf-thumbnail-card>
        `
      )}
    </div>`;
  }

  render() {
    // Slider is visually inverted: dragging right reduces column
    // count (bigger thumbnails). We pass `MIN + MAX - columns` to the
    // slider so the right edge corresponds to 1 thumbnail per row,
    // and undo the mapping in the change handler.
    const sliderValue = MIN_COLUMNS + MAX_COLUMNS - this.columns;
    const visible = this.filteredPhotos;
    const filtersActive = this.filtersActive;
    const metadataLoading = this.filterMetadataLoading;
    const focalBounds = this.focalBounds;
    const groups = this.getDayGroups(visible);
    return html`
      <div class="grid-header">
        <div class="header-row">
          <h2 class="folder-title" title=${this.folderName ?? ""}>
            ${this.folderName ?? ""}
          </h2>
          <label class="subfolder-toggle" title="Show photos from all nested subfolders of the selected folder">
            <input type="checkbox" .checked=${this.includeSubfolders} @change=${this.toggleIncludeSubfolders} />
            Include subfolders
          </label>
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
        <div class="filter-panel">
          <div class="filter-panel-heading">
            <span class="filter-summary">
              ${filtersActive ? `${visible.length} of ${this.photos.length}` : `${this.photos.length} photos`}
              ${metadataLoading ? " · Reading camera info…" : ""}
              <button
                type="button"
                class="filter-clear"
                ?disabled=${!filtersActive}
                @click=${this.clearFilters}
              >Clear</button>
            </span>
          </div>
          <div class="filter-controls">
            <label class="filter-control">
              <input
                type="text"
                list="camera-options"
                placeholder="Camera"
                aria-label="Camera"
                .value=${this.cameraFilter}
                @input=${(e: Event) => this.setTextFilter("camera", e)}
              />
            </label>
            <label class="filter-control">
              <input
                type="text"
                list="lens-options"
                placeholder="Lens"
                aria-label="Lens"
                .value=${this.lensFilter}
                @input=${(e: Event) => this.setTextFilter("lens", e)}
              />
            </label>
            <div class="focal-range">
              <span class="focal-range-label">Focal length (mm)</span>
              <div class="focal-inputs">
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  placeholder=${focalBounds ? `From ${focalBounds.min}` : "Min"}
                  .value=${this.minFocalLength?.toString() ?? ""}
                  aria-label="Minimum focal length"
                  @input=${(e: Event) => this.setFocalLength("min", e)}
                />
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  placeholder=${focalBounds ? `To ${focalBounds.max}` : "Max"}
                  .value=${this.maxFocalLength?.toString() ?? ""}
                  aria-label="Maximum focal length"
                  @input=${(e: Event) => this.setFocalLength("max", e)}
                />
              </div>
            </div>
            <div class="date-range">
              <span class="focal-range-label">Date taken</span>
              <div class="date-inputs">
                <input
                  type="date"
                  .value=${this.startDate}
                  aria-label="Start date"
                  @change=${(e: Event) => this.setDate("start", e)}
                />
                <input
                  type="date"
                  .value=${this.endDate}
                  aria-label="End date"
                  @change=${(e: Event) => this.setDate("end", e)}
                />
              </div>
            </div>
          </div>
          <div class="filter-options">
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
          </div>
          <datalist id="camera-options">
            ${this.cameraOptions.map((camera) => html`<option value=${camera}></option>`)}
          </datalist>
          <datalist id="lens-options">
            ${this.lensOptions.map((lens) => html`<option value=${lens}></option>`)}
          </datalist>
        </div>
      </div>
      <div class="grid-scroll">
        ${visible.length === 0 && filtersActive
          ? html`<div class="empty-filter">
              No photos match the current filters.
            </div>`
          : groups.map((group) => {
              const key = group.date ?? "undated";
              const expanded = !this.collapsedDays.has(key);
              return html`<section class="day-group">
                <button
                  type="button"
                  class="day-heading"
                  aria-expanded=${expanded}
                  aria-controls=${`day-${key}`}
                  @click=${() => this.toggleDay(group.date)}
                >
                  <span class="day-title">${this.formatDay(group.date)}</span>
                  <span class="day-count">${group.photos.length} photo${group.photos.length === 1 ? "" : "s"}</span>
                  <span class="day-chevron" aria-hidden="true">⌄</span>
                </button>
                ${expanded
                  ? html`<div id=${`day-${key}`}>
                      ${this.renderPhotoCards(
                        group.photos.slice(
                          0,
                          this.visiblePhotoCount(key, group.photos.length)
                        )
                      )}
                      ${this.visiblePhotoCount(key, group.photos.length) <
                      group.photos.length
                        ? html`<div class="group-load-more" data-day=${key}>
                            <button
                              type="button"
                              @click=${() => this.showMoreForDay(key)}
                            >Show more photos</button>
                          </div>`
                        : null}
                    </div>`
                  : null}
              </section>`;
            })}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-photo-grid": PfPhotoGrid;
  }
}

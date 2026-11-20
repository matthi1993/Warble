import { LitElement, html, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { cameraOptions, lensOptions, variantCount, type Photo, type PhotoDayGroup } from "@warble/library";
import { app } from "@app/composition/app";
import "@ui/controls/pf-slider";
import { GridColumnsController } from "./grid-columns-controller";
import { GridLayoutController } from "./grid-layout-controller";
import { GridLoadMoreController } from "./grid-load-more-controller";
import type { CardDragStart, CardSelection } from "./grid-selection-controller";
import "./pf-photo-filter-panel";
import { photoGridStyles } from "./pf-photo-grid.styles";
import "./pf-thumbnail-card";
import { PhotoGridController } from "./photo-grid-controller";

@customElement("pf-photo-grid")
export class PfPhotoGrid extends LitElement {
  static styles = photoGridStyles;

  @property({ attribute: false })
  photos: Photo[] = [];

  @property({ type: String })
  selectedPath: string | null = null;

  @property({ type: String })
  folderName: string | null = null;

  @property({ type: Boolean })
  includeSubfolders = false;

  @property({ type: Boolean })
  showSubfolderToggle = true;

  @property({ type: Boolean })
  filterMetadataLoading = false;

  /** Hides the header while the full view covers the grid, so it does not show through the overlay. */
  @property({ type: Boolean, reflect: true, attribute: "full-view-open" })
  fullViewOpen = false;

  private readonly layout = new GridLayoutController(() => this.renderRoot);
  private readonly grid = new PhotoGridController(this, {
    ratings: app.library.ratings,
    storage: app.platform.storage,
    layout: this.layout,
  });
  private readonly loadMore = new GridLoadMoreController(this.grid.days);

  connectedCallback(): void {
    super.connectedCallback();
    this.grid.connect();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.grid.disconnect();
    this.loadMore.disconnect();
  }

  getSelectionPaths(): string[] {
    return this.grid.selection.getSelectionPaths();
  }

  selectAll(): void {
    this.grid.selection.selectAll();
  }

  scrollSelectionIntoView(): void {
    this.layout.scrollToPhoto(this.selectedPath);
  }

  /** Moves the selection by whole cells; rows follow the live thumbnail layout. */
  moveSelection(dx: number, dy: number): boolean {
    return this.grid.selection.moveSelection(dx, dy);
  }

  openSelected(): void {
    this.grid.selection.openSelected();
  }

  protected firstUpdated(): void {
    this.grid.firstRendered();
  }

  protected updated(changed: PropertyValues<this>): void {
    this.grid.hostUpdated({
      photos: changed.has("photos"),
      selectedPath: changed.has("selectedPath"),
      fullViewClosed: changed.get("fullViewOpen") === true && !this.fullViewOpen,
    });
    this.loadMore.observeLoadMoreControls(this.renderRoot);
    this.grid.selection.publishSelection();
  }

  private onCardSelected(event: CustomEvent<CardSelection>): void {
    event.stopPropagation();
    this.grid.selection.selectCard(event.detail);
  }

  private onCardContextMenu(event: CustomEvent<{ path: string; longPress?: boolean }>): void {
    this.grid.selection.selectForContextMenu(event.detail);
  }

  private onCardPointerDragStart(event: CustomEvent<CardDragStart>): void {
    event.stopPropagation();
    this.grid.selection.startPointerDrag(event.detail);
  }

  private toggleIncludeSubfolders(): void {
    this.dispatchEvent(new CustomEvent("toggle-include-subfolders", { bubbles: true, composed: true }));
  }

  private renderHeader(): TemplateResult {
    const { columns, filters } = this.grid;
    const total = this.photos.length;
    const count = filters.filtersActive ? `${this.grid.filteredPhotos.length} of ${total}` : total;
    return html`<div class="grid-header">
      <div class="header-row">
        <div class="folder-heading">
          <h2 class="folder-title" title=${this.folderName ?? ""}>${this.folderName ?? ""}</h2>
          <span class="count">${count} photos${this.filterMetadataLoading ? " · Reading camera info…" : ""}</span>
        </div>
        ${this.showSubfolderToggle
          ? html`<label class="subfolder-toggle" title="Show photos from all nested subfolders of the selected folder">
              <input type="checkbox" .checked=${this.includeSubfolders} @change=${this.toggleIncludeSubfolders} />
              Include subfolders
            </label>`
          : null}
        <div class="size-controls">
          <span class="label">Size</span>
          <pf-slider
            min=${GridColumnsController.MIN}
            max=${GridColumnsController.MAX}
            step="1"
            fill-from=${GridColumnsController.MIN}
            .value=${columns.sliderValue}
            .label=${"Thumbnails per row"}
            @change=${(event: CustomEvent<number>) => columns.setFromSlider(event.detail)}
          ></pf-slider>
        </div>
      </div>
      <pf-photo-filter-panel
        .filters=${filters}
        .criteria=${filters.criteria}
        .active=${filters.filtersActive}
        .expanded=${filters.expanded}
        .cameras=${cameraOptions(this.photos)}
        .lenses=${lensOptions(this.photos)}
      ></pf-photo-filter-panel>
    </div>`;
  }

  private renderDayGroup(group: PhotoDayGroup): TemplateResult {
    const { days } = this.grid;
    const day = days.dayKey(group);
    const expanded = days.isExpanded(group);
    return html`<section class="day-group">
      <button
        type="button"
        class="day-heading"
        aria-expanded=${expanded}
        aria-controls=${`day-${day}`}
        @click=${() => days.toggleDay(group)}
      >
        <span class="day-title">${days.formatDay(group.date)}</span>
        <span class="day-count">${group.photos.length} photo${group.photos.length === 1 ? "" : "s"}</span>
        <span class="day-chevron" aria-hidden="true">⌄</span>
      </button>
      ${expanded
        ? html`<div id=${`day-${day}`}>
            ${this.renderPhotoCards(days.visiblePhotos(group))}
            ${days.hasMorePhotos(group)
              ? html`<div class="group-load-more" data-day=${day}>
                  <button type="button" @click=${() => days.showMoreForDay(day)}>Show more photos</button>
                </div>`
              : null}
          </div>`
        : null}
    </section>`;
  }

  private renderPhotoCards(photos: Photo[]): TemplateResult {
    const { selection } = this.grid;
    return html`<div
      class="grid"
      style=${`--pf-grid-cols: ${this.grid.columns.count}`}
      @photo-selected=${this.onCardSelected}
      @photo-context-menu=${this.onCardContextMenu}
      @photo-pointer-drag-start=${this.onCardPointerDragStart}
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
            ?selected=${selection.isSelected(photo.path)}
            .showSelectionCheck=${!this.fullViewOpen}
          ></pf-thumbnail-card>
        `,
      )}
    </div>`;
  }

  render() {
    const { days, filters } = this.grid;
    const noMatches = this.grid.filteredPhotos.length === 0 && filters.filtersActive;
    return html`
      ${this.renderHeader()}
      <div class="grid-scroll">
        ${noMatches
          ? html`<div class="empty-filter">No photos match the current filters.</div>`
          : days.visibleGroups.map((group) => this.renderDayGroup(group))}
        ${days.hasMoreGroups
          ? html`<div class="groups-load-more">
              <button type="button" @click=${() => days.showMoreGroups()}>Show more days</button>
            </div>`
          : null}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-photo-grid": PfPhotoGrid;
  }
}

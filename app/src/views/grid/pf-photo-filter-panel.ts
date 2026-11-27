import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  COLOR_LABELS,
  LABEL_COLORS,
  LABEL_DISPLAY_NAMES,
  PhotoFilter,
  type MediaType,
  type PhotoFilterCriteria,
} from "@warble/library";
import "@ui/icons/pf-icon";
import type { GridFilterController } from "./grid-filter-controller";
import { photoFilterPanelStyles } from "./pf-photo-filter-panel.styles";

const MEDIA_TYPE_NAMES: Record<MediaType, string> = { image: "Image", raw: "RAW", movie: "Movie" };

/** The collapsible filter controls of the photo grid; state and actions live in the grid's filter controller. */
@customElement("pf-photo-filter-panel")
export class PfPhotoFilterPanel extends LitElement {
  static styles = photoFilterPanelStyles;

  @property({ attribute: false })
  filters!: GridFilterController;

  @property({ attribute: false })
  criteria: PhotoFilterCriteria = PhotoFilter.emptyCriteria();

  @property({ type: Boolean })
  active = false;

  @property({ type: Boolean })
  expanded = false;

  @property({ attribute: false })
  cameras: string[] = [];

  @property({ attribute: false })
  lenses: string[] = [];

  private inputValue(event: Event): string {
    return (event.target as HTMLSelectElement | HTMLInputElement).value;
  }

  private renderSelect(label: string, allLabel: string, value: string, options: string[], change: (value: string) => void) {
    return html`<label class="filter-control">
      <span class="filter-label">${label}</span>
      <span class="select-wrap">
        <select aria-label=${label} .value=${value} @change=${(event: Event) => change(this.inputValue(event))}>
          <option value="">${allLabel}</option>
          ${options.map((option) => html`<option value=${option}>${option}</option>`)}
        </select>
        <pf-icon name="chevron-down"></pf-icon>
      </span>
    </label>`;
  }

  private renderToggles() {
    const { filters, criteria } = this;
    return html`<div class="filter-options">
      <span class="filter-group">
        <span class="label">Type</span>
        <span class="type-filters" role="group" aria-label="Filter by file type">
          ${(["image", "raw", "movie"] as const).map(
            (type) => html`<button
              type="button"
              aria-pressed=${criteria.types.has(type)}
              @click=${() => filters.toggleType(type)}
            >${MEDIA_TYPE_NAMES[type]}</button>`,
          )}
        </span>
      </span>
      <span class="filter-group">
        <span class="label">Stars</span>
        <span class="stars-filter" role="radiogroup" aria-label="Filter by minimum rating">
          ${[1, 2, 3, 4, 5].map(
            (stars) => html`<button
              type="button"
              class=${stars <= criteria.minStars ? "active" : ""}
              role="radio"
              aria-checked=${stars === criteria.minStars}
              title=${`At least ${stars} star${stars === 1 ? "" : "s"}`}
              @click=${() => filters.setMinStars(stars)}
            >
              ★
            </button>`,
          )}
        </span>
      </span>
      <span class="filter-group">
        <span class="label">Label</span>
        <span class="label-chips" role="group" aria-label="Filter by color label">
          ${COLOR_LABELS.map(
            (label) => html`<button
              type="button"
              class=${criteria.labels.has(label) ? "active" : ""}
              style=${`background: ${LABEL_COLORS[label]};`}
              title=${LABEL_DISPLAY_NAMES[label]}
              aria-label=${LABEL_DISPLAY_NAMES[label]}
              aria-pressed=${criteria.labels.has(label)}
              @click=${() => filters.toggleLabelFilter(label)}
            ></button>`,
          )}
        </span>
      </span>
      <button
        type="button"
        class="filter-clear"
        ?disabled=${!this.active}
        @click=${() => filters.clearFilters()}
      >Clear filters</button>
    </div>`;
  }

  render() {
    const { filters, criteria } = this;
    return html`<div class="filter-panel">
      <button
        type="button"
        class="filter-toggle"
        aria-expanded=${this.expanded}
        aria-controls="filter-content"
        @click=${() => filters.toggleExpanded()}
      >
        Filters
        ${this.active ? html`<span class="filter-status">Active</span>` : null}
        <pf-icon name="chevron-down"></pf-icon>
      </button>
      <div id="filter-content" class="filter-content" ?hidden=${!this.expanded}>
        <div class="filter-controls">
          ${this.renderSelect("Camera", "All cameras", criteria.camera, this.cameras, (camera) => filters.setCamera(camera))}
          ${this.renderSelect("Lens", "All lenses", criteria.lens, this.lenses, (lens) => filters.setLens(lens))}
          <div class="date-range">
            <span class="filter-label">Date taken</span>
            <div class="date-inputs">
              <input
                type="date"
                .value=${criteria.startDate}
                aria-label="Start date"
                @change=${(event: Event) => filters.setStartDate(this.inputValue(event))}
              />
              <input
                type="date"
                .value=${criteria.endDate}
                aria-label="End date"
                @change=${(event: Event) => filters.setEndDate(this.inputValue(event))}
              />
            </div>
          </div>
        </div>
        ${this.renderToggles()}
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-photo-filter-panel": PfPhotoFilterPanel;
  }
}

import { LitElement, html, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { LABEL_COLORS, LABEL_DISPLAY_NAMES } from "@warble/library";
import { app } from "@app/composition/app";
import { ratingOverlayStyles } from "./pf-rating-overlay.styles";
import { RatingOverlayController } from "./rating-overlay-controller";

@customElement("pf-rating-overlay")
export class PfRatingOverlay extends LitElement {
  static styles = ratingOverlayStyles;

  @property({ type: String })
  path = "";

  /** Shows the badges even on an unrated photo, for example while the full view's chrome is on screen. */
  @property({ type: Boolean, reflect: true })
  forceVisible = false;

  /** In the fullscreen view the badges stay hidden unless forced visible or recently changed. */
  @property({ type: Boolean, reflect: true })
  fullscreen = false;

  private readonly overlay = new RatingOverlayController(this, app.library.ratings);

  connectedCallback(): void {
    super.connectedCallback();
    this.overlay.connect();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.overlay.disconnect();
  }

  willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("path")) this.overlay.pathChanged();
  }

  // The click must not reach the thumbnail card, which would select or open the photo.
  private onStarClick(event: MouseEvent, star: number): void {
    event.preventDefault();
    event.stopPropagation();
    this.overlay.rate(star);
  }

  private keepPointerFromCard(event: PointerEvent): void {
    event.stopPropagation();
  }

  render() {
    const { rating, label } = this.overlay.value;
    const labelTitle = label ? LABEL_DISPLAY_NAMES[label] : "";
    const labelBadge = label
      ? html`<span
          class=${this.fullscreen ? "label label-text" : "label"}
          style=${`--pf-rating-label-color: ${LABEL_COLORS[label]};`}
          title=${labelTitle}
          aria-label=${labelTitle}
        >${this.fullscreen ? labelTitle : nothing}</span>`
      : nothing;
    const starsBadge = html`<span
      class=${`stars${rating === 0 ? " idle" : ""}`}
      role="radiogroup"
      aria-label="Rating"
      @pointerdown=${this.keepPointerFromCard}
    >
      ${[1, 2, 3, 4, 5].map(
        (star) => html`<button
          type="button"
          role="radio"
          aria-checked=${star === rating}
          class=${star <= rating ? "filled" : ""}
          title=${star === rating ? "Clear rating" : `${star} star${star === 1 ? "" : "s"}`}
          @click=${(event: MouseEvent) => this.onStarClick(event, star)}
        >
          ★
        </button>`,
      )}
    </span>`;
    return this.fullscreen
      ? html`<div class="fullscreen-badges">${labelBadge}${starsBadge}</div>`
      : html`${labelBadge}${starsBadge}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-rating-overlay": PfRatingOverlay;
  }
}

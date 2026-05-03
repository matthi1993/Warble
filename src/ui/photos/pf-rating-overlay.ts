/**
 * Visual overlay showing a photo's star rating (bottom-right) and
 * color label (top-left). The stars are always interactive: clicking
 * one sets the rating to that value, and clicking the leftmost
 * filled star a second time clears the rating. The overlay
 * subscribes to the rating store directly so it updates when the
 * user presses a shortcut without the parent having to thread state
 * through.
 *
 * Used by both the grid thumbnail card and the full-image view
 * canvas.
 */
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  getPhotoRating,
  LABEL_COLORS,
  LABEL_DISPLAY_NAMES,
  setPhotoStars,
  subscribePhotoRatings,
  type PhotoRating,
} from "../../app/rating-store";

@customElement("pf-rating-overlay")
export class PfRatingOverlay extends LitElement {
  static styles = css`
    :host {
      position: absolute;
      inset: 0;
      pointer-events: none;
      display: block;
    }
    .label {
      position: absolute;
      left: var(--pf-rating-inset, 8px);
      top: var(--pf-rating-inset, 8px);
      width: var(--pf-rating-label-size, 12px);
      height: var(--pf-rating-label-size, 12px);
      border-radius: 2px;
      background: var(--pf-rating-label-color, transparent);
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45);
    }
    .stars {
      position: absolute;
      right: var(--pf-rating-inset, 8px);
      bottom: var(--pf-rating-inset, 8px);
      display: inline-flex;
      gap: 1px;
      padding: 3px 6px;
      background: rgba(0, 0, 0, 0.55);
      border-radius: 999px;
      color: rgba(255, 255, 255, 0.85);
      font-size: var(--pf-rating-star-size, 10px);
      line-height: 1;
      letter-spacing: 1px;
      pointer-events: auto;
      transition: opacity var(--pf-transition, 120ms ease-out);
    }
    /* When the photo has no rating yet, the stars only fade in on
       hover/focus so the overlay stays out of the way until the
       user wants to rate. */
    .stars.idle {
      opacity: 0;
    }
    :host(:hover) .stars.idle,
    .stars.idle:focus-within {
      opacity: 1;
    }
    .stars button {
      background: transparent;
      border: 0;
      padding: 0 1px;
      margin: 0;
      cursor: pointer;
      color: rgba(255, 255, 255, 0.3);
      font: inherit;
      line-height: 1;
    }
    .stars button.filled {
      color: rgba(255, 255, 255, 0.9);
    }
    .stars button:hover {
      color: #fff;
    }
  `;

  @property({ type: String })
  path = "";

  @state()
  private value: PhotoRating = { rating: 0, label: "", ratedAt: 0 };

  private unsubscribe: (() => void) | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    this.value = getPhotoRating(this.path);
    this.unsubscribe = subscribePhotoRatings((p) => {
      if (p === this.path || p === "") {
        this.value = getPhotoRating(this.path);
      }
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("path")) {
      this.value = getPhotoRating(this.path);
    }
  }

  private onStarClick = (e: MouseEvent, n: number) => {
    // Don't let the click bubble up to the thumbnail card's click
    // handler (which would otherwise select or open the photo).
    e.preventDefault();
    e.stopPropagation();
    if (!this.path) return;
    // Clicking the current rating's lowest star clears back to 0;
    // any other click sets the rating to that exact value.
    const next = this.value.rating === n && n === 1 ? 0 : n;
    setPhotoStars(this.path, next);
  };

  private onStarsPointerDown = (e: PointerEvent) => {
    // Stop the card from interpreting this as a select/open gesture
    // on pointerdown — some browsers fire selection on pointerdown
    // before the click event resolves.
    e.stopPropagation();
  };

  render() {
    const { rating, label } = this.value;
    const color = label ? LABEL_COLORS[label] : "";
    const labelTitle = label ? LABEL_DISPLAY_NAMES[label] : "";
    return html`
      ${label
        ? html`<span
            class="label"
            style=${`--pf-rating-label-color: ${color};`}
            title=${labelTitle}
            aria-label=${labelTitle}
          ></span>`
        : nothing}
      <span
        class=${`stars${rating === 0 ? " idle" : ""}`}
        role="radiogroup"
        aria-label="Rating"
        @pointerdown=${this.onStarsPointerDown}
      >
        ${[1, 2, 3, 4, 5].map(
          (i) => html`<button
            type="button"
            role="radio"
            aria-checked=${i === rating}
            class=${i <= rating ? "filled" : ""}
            title=${i === rating
              ? `Clear rating`
              : `${i} star${i === 1 ? "" : "s"}`}
            @click=${(e: MouseEvent) => this.onStarClick(e, i)}
          >
            ★
          </button>`
        )}
      </span>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-rating-overlay": PfRatingOverlay;
  }
}


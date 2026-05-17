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
  LABEL_COLORS,
  LABEL_DISPLAY_NAMES,
  type PhotoRating,
} from "@domain/rating";
import {
  getPhotoRating,
  setPhotoStars,
  subscribePhotoRatings,
} from "@services/rating/rating-store";

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
    .stars.idle:focus-within,
    :host([forceVisible]) .stars.idle,
    :host([flashing]) .stars.idle {
      opacity: 1;
    }
    /* In fullscreen we hide both badges by default and let the
       host force them visible (when chrome is on screen) or flash
       them for a second when the value changes. */
    :host([fullscreen]) .stars,
    :host([fullscreen]) .label {
      opacity: 0;
      transition: opacity 180ms ease-out;
    }
    :host([fullscreen][forceVisible]) .stars,
    :host([fullscreen][forceVisible]) .label,
    :host([fullscreen][flashing]) .stars,
    :host([fullscreen][flashing]) .label,
    :host([fullscreen]:hover) .stars,
    :host([fullscreen]:hover) .label {
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

  /** When true, force the stars (and label) to be visible even on
   *  an unrated photo. Used by the full-view shell while its
   *  chrome (header/footer) is showing in fullscreen — so the
   *  overlay sits alongside the rest of the UI rather than hiding
   *  unless the cursor is exactly over the canvas. */
  @property({ type: Boolean, reflect: true })
  forceVisible = false;

  /** When true, the overlay is being shown in the fullscreen view.
   *  Both the stars and the colour label hide by default in that
   *  mode — they only appear while `forceVisible` is on (chrome
   *  showing) or `flashing` (recently changed). */
  @property({ type: Boolean, reflect: true })
  fullscreen = false;

  /** Auto-set for ~1s whenever the rating or label value changes
   *  so the user gets a brief on-image confirmation in fullscreen
   *  mode even when both badges are otherwise hidden. */
  @state()
  private flashing = false;

  private flashTimer: number | null = null;

  @state()
  private value: PhotoRating = { rating: 0, label: "", ratedAt: 0 };

  private unsubscribe: (() => void) | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    this.value = getPhotoRating(this.path);
    this.unsubscribe = subscribePhotoRatings((p) => {
      if (p === this.path || p === "") {
        const next = getPhotoRating(this.path);
        const changed =
          next.rating !== this.value.rating || next.label !== this.value.label;
        this.value = next;
        if (changed) this.startFlash();
      }
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.flashTimer !== null) {
      clearTimeout(this.flashTimer);
      this.flashTimer = null;
    }
  }

  /** Briefly reveal the badges (rating + label) for 1s, then hide
   *  them again. Used to surface user actions in fullscreen where
   *  the overlay would otherwise stay invisible. */
  private startFlash(): void {
    this.flashing = true;
    this.toggleAttribute("flashing", true);
    if (this.flashTimer !== null) clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => {
      this.flashing = false;
      this.toggleAttribute("flashing", false);
      this.flashTimer = null;
    }, 1000);
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


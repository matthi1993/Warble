import { css } from "lit";

export const ratingOverlayStyles = css`
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
  .fullscreen-badges {
    position: absolute;
    bottom: calc(
      var(--pf-rating-inset, 8px) +
        var(--pf-rating-bottom-offset, 0px)
    );
    left: 50%;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    pointer-events: none;
    transform: translateX(-50%);
  }
  .fullscreen-badges .label {
    position: static;
    width: auto;
    height: auto;
    padding: 3px 8px;
    border-radius: 999px;
    color: #fff;
    font-size: var(--pf-text-xs, 0.7rem);
    font-weight: 700;
    line-height: 1;
    white-space: nowrap;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
  }
  .fullscreen-badges .stars {
    position: static;
  }
  .stars.idle {
    opacity: 0;
  }
  :host(:hover) .stars.idle,
  .stars.idle:focus-within,
  :host([forceVisible]) .stars.idle,
  :host([flashing]) .stars.idle {
    opacity: 1;
  }
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

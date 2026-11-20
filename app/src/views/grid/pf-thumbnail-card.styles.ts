import { css } from "lit";

export const thumbnailCardStyles = css`
  :host {
    display: block;
    width: 100%;
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0;
    padding: 4px;
    border-radius: var(--pf-radius-md);
    background: var(--pf-surface-2);
    border: 1px solid var(--pf-border);
    cursor: pointer;
    user-select: none;
    -webkit-touch-callout: none;
    touch-action: pan-y;
    transition: border-color var(--pf-transition), box-shadow var(--pf-transition),
      transform var(--pf-transition);
  }
  .card:hover {
    border-color: var(--pf-accent);
  }
  :host([selected]) .card {
    border-color: var(--pf-accent);
    box-shadow: 0 0 0 1px var(--pf-accent);
  }
  .selection-check {
    position: absolute;
    top: 6px;
    left: 6px;
    z-index: 2;
    width: 17px;
    height: 17px;
    display: grid;
    place-items: center;
    border-radius: 2px;
    background: #f58a1f;
    color: #fff;
    font-size: 13px;
    font-weight: 700;
    pointer-events: none;
  }
  /* A square of the cell width, so the grid's column count drives the thumbnail size. */
  .thumb {
    width: 100%;
    aspect-ratio: 1 / 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--pf-bg);
    border-radius: var(--pf-radius-sm);
    overflow: hidden;
    position: relative;
    color: var(--pf-text-subtle);
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    -webkit-user-drag: none;
  }
  .thumb video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }
  .placeholder {
    font-size: 1.25rem;
    color: var(--pf-text-subtle);
  }
  .filename {
    font-size: var(--pf-text-xs);
    color: var(--pf-text);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 6px 3px 2px;
  }
  .error {
    display: inline-flex;
    align-items: center;
    gap: var(--pf-space-1);
    font-size: var(--pf-text-xs);
    color: var(--pf-danger);
    padding: var(--pf-space-1);
    text-align: center;
  }
  .badge {
    position: absolute;
    top: 5px;
    right: 5px;
    display: flex;
    gap: 2px;
    pointer-events: none;
  }
  .badge span {
    background: rgba(0, 0, 0, 0.65);
    color: #fff;
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    padding: 1px 5px;
    border-radius: 999px;
    text-transform: uppercase;
  }
  .badge span.variants {
    background: var(--pf-accent);
    text-transform: none;
  }
`;

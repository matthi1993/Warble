import { css } from "lit";
import { CURVE_GRID_SIZE } from "./curve-grid-geometry";

export const curveEditorStyles = css`
  :host {
    display: block;
  }
  .channels {
    display: flex;
    gap: 4px;
    margin-bottom: 8px;
  }
  .channels button {
    flex: 1;
    background: transparent;
    border: 1px solid var(--pf-border);
    color: var(--pf-text-muted);
    border-radius: 4px;
    padding: 4px 0;
    font-size: 0.7rem;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }
  .channels button.active {
    background: var(--pf-surface-hover);
    color: var(--pf-text);
    border-color: var(--pf-border-strong, var(--pf-border));
  }
  .channels .swatch {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    display: inline-block;
  }
  .grid {
    position: relative;
    width: 100%;
    aspect-ratio: 1 / 1;
    max-width: ${CURVE_GRID_SIZE}px;
    margin: 0 auto;
    background: var(--pf-surface-2, rgba(0, 0, 0, 0.25));
    border: 1px solid var(--pf-border);
    border-radius: 4px;
    overflow: hidden;
    user-select: none;
    touch-action: none;
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  .gridline {
    stroke: var(--pf-text-muted);
    stroke-width: 1;
    opacity: 0.55;
  }
  .gridline.minor {
    opacity: 0.25;
  }
  .diagonal {
    stroke: var(--pf-text-muted);
    stroke-width: 1;
    stroke-dasharray: 3 3;
    opacity: 0.6;
  }
  .curve {
    fill: none;
    stroke-width: 1.5;
  }
  .handle {
    cursor: grab;
  }
  .handle:active {
    cursor: grabbing;
  }
  .handle circle {
    fill: var(--pf-bg, #1a1a1a);
    stroke-width: 1.5;
  }
`;

import { css } from "lit";

export const stageStyles = css`
  .stage {
    flex: 1;
    position: relative;
    overflow: hidden;
    background: var(--pf-fv-bg, #000);
    min-height: 0;
  }
  .stage-row {
    flex: 1;
    display: flex;
    min-height: 0;
    min-width: 0;
    position: relative;
  }
  :host([immersive]) .stage-row {
    position: absolute;
    inset: 0;
  }
  pf-image-canvas, pf-video-view {
    position: absolute;
    inset: 0;
  }
  .live-toggle {
    position: absolute;
    z-index: 4;
    left: 16px;
    top: 16px;
    border: 1px solid var(--pf-border-strong);
    border-radius: var(--pf-radius-md);
    padding: 8px 12px;
    background: var(--pf-surface-2);
    color: var(--pf-text);
    cursor: pointer;
  }
  .slideshow-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: none;
    pointer-events: none;
    z-index: 2;
  }
  .fv-rating-overlay {
    position: absolute;
    inset: 0;
    z-index: 11;
    pointer-events: none;
  }
  :host([immersive][controls-hidden]) .fv-rating-overlay {
    visibility: hidden;
  }
`;

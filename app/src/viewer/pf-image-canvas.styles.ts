import { css } from "lit";

export const imageCanvasStyles = css`
  :host {
    display: block;
    position: relative;
    overflow: hidden;
    background: var(--pf-canvas-bg, transparent);
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    box-sizing: border-box;
  }
  canvas {
    width: 100%;
    height: 100%;
    display: block;
    cursor: grab;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  canvas.dragging {
    cursor: grabbing;
  }
  :host([presenting]) canvas {
    cursor: none !important;
  }
  :host([cropMode]) canvas {
    cursor: default;
  }
  :host([cropMode][cursor="move"]) canvas {
    cursor: move;
  }
  :host([cropMode][cursor="ns"]) canvas {
    cursor: ns-resize;
  }
  :host([cropMode][cursor="ew"]) canvas {
    cursor: ew-resize;
  }
  :host([cropMode][cursor="nwse"]) canvas {
    cursor: nwse-resize;
  }
  :host([cropMode][cursor="nesw"]) canvas {
    cursor: nesw-resize;
  }
  :host([cropMode][cursor="horizon"]) canvas {
    cursor: crosshair;
  }
  .status {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--pf-text-muted, rgba(255, 255, 255, 0.7));
    font-size: var(--pf-text-sm);
    pointer-events: none;
  }
  .status.error {
    color: #ff8080;
  }
  .loading-spinner {
    position: absolute;
    left: 12px;
    bottom: 12px;
    width: 18px;
    height: 18px;
    border: 2px solid rgba(255, 255, 255, 0.18);
    border-top-color: rgba(255, 255, 255, 0.85);
    border-radius: 50%;
    animation: pf-canvas-spin 0.9s linear infinite;
    pointer-events: none;
  }
  @keyframes pf-canvas-spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

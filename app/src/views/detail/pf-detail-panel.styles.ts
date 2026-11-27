import { css } from "lit";

export const detailPanelStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--pf-surface);
    color: var(--pf-text);
    overflow: hidden;
  }
  .image-wrap {
    flex: 0 0 auto;
    position: relative;
    background: var(--pf-surface);
    padding: var(--pf-space-3);
    min-height: 0;
    height: min(34vh, 260px);
  }
  pf-image-canvas, pf-video-view {
    width: 100%;
    height: 100%;
    border-radius: var(--pf-radius-md);
    overflow: hidden;
    background: var(--pf-surface-2);
  }
  .expand-btn {
    position: absolute;
    top: var(--pf-space-2);
    right: var(--pf-space-2);
    background: var(--pf-surface);
    border-radius: var(--pf-radius-md);
    box-shadow: var(--pf-shadow-md);
    z-index: 1;
  }
  .fullscreen-btn {
    position: absolute;
    top: var(--pf-space-2);
    right: calc(var(--pf-space-2) + 40px);
    background: var(--pf-surface);
    border-radius: var(--pf-radius-md);
    box-shadow: var(--pf-shadow-md);
    z-index: 1;
  }
  .meta {
    padding: var(--pf-space-2) var(--pf-space-3) var(--pf-space-4);
    font-size: var(--pf-text-sm);
    display: flex;
    flex-direction: column;
    gap: var(--pf-space-3);
    overflow-y: auto;
    min-height: 0;
  }
  .filename {
    font-weight: 700;
    font-size: var(--pf-text-base);
    word-break: break-all;
  }
  .photo-facts {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .photo-facts span {
    padding: 3px 6px;
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-radius-sm);
    color: var(--pf-text-muted);
    font-size: var(--pf-text-xs);
  }
  .info-section {
    border-top: 1px solid var(--pf-border);
    padding-top: var(--pf-space-3);
  }
  .info-section h3 {
    margin: 0 0 var(--pf-space-2);
    color: var(--pf-text-muted);
    font-size: var(--pf-text-xs);
    font-weight: 600;
  }
  .info-section dl { margin: 0; }
  .info-row {
    display: grid;
    grid-template-columns: 90px minmax(0, 1fr);
    gap: var(--pf-space-2);
    padding: 5px 0;
    font-size: var(--pf-text-xs);
  }
  .info-row dt { color: var(--pf-text-muted); }
  .info-row dd { margin: 0; overflow-wrap: anywhere; }
  .rating-controls, .label-controls { display: inline-flex; align-items: center; gap: 3px; }
  .rating-controls button {
    border: 0;
    background: none;
    padding: 0 2px;
    color: var(--pf-text-subtle);
    font-size: 19px;
    cursor: pointer;
  }
  .rating-controls button.active { color: var(--pf-accent); }
  .label-controls button {
    width: 18px;
    height: 18px;
    padding: 0;
    border: 1px solid var(--pf-border);
    border-radius: 4px;
    opacity: .55;
    cursor: pointer;
  }
  .label-controls button[aria-pressed="true"] { opacity: 1; outline: 2px solid var(--pf-accent); outline-offset: 2px; }
  .path {
    color: var(--pf-text-muted);
    word-break: break-all;
    font-size: var(--pf-text-xs);
  }
`;

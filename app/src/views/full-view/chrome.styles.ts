import { css } from "lit";

export const chromeStyles = css`
  :host {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--pf-fv-bg, #000);
    color: var(--pf-fv-fg, #fff);
    outline: none;
    overflow: hidden;
  }
  :host([presenting]),
  :host([presenting]) * {
    cursor: none !important;
  }
  .toolbar-wrap,
  .bottombar-wrap {
    position: relative;
    z-index: 30;
    transition: opacity 200ms ease;
  }
  :host([immersive]) .toolbar-wrap,
  :host([immersive]) .bottombar-wrap {
    position: absolute;
    left: var(--pf-fullview-left-inset, 0px);
    right: 0;
  }
  :host([immersive]) .toolbar-wrap { top: 0; }
  :host([immersive]) .bottombar-wrap { bottom: 0; }
  :host([immersive]) .toolbar,
  :host([immersive]) .bottombar {
    background: color-mix(in srgb, var(--pf-surface) 86%, transparent);
    backdrop-filter: blur(16px) saturate(1.15);
    -webkit-backdrop-filter: blur(16px) saturate(1.15);
  }
  :host([immersive][controls-hidden]) .toolbar-wrap,
  :host([immersive][controls-hidden]) .bottombar-wrap {
    opacity: 0;
    pointer-events: none;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--pf-space-2);
    padding: var(--pf-space-2) var(--pf-space-3);
    background: var(--pf-surface);
    color: var(--pf-text);
    border-bottom: 1px solid var(--pf-border);
  }
  .toolbar-left,
  .toolbar-right {
    display: flex;
    align-items: center;
    gap: var(--pf-space-2);
    flex: 1 1 0;
    min-width: 0;
  }
  .toolbar-right {
    justify-content: flex-end;
  }
  .toolbar-center {
    display: flex;
    align-items: center;
    gap: var(--pf-space-2);
    flex: 0 0 auto;
  }
  /* View controls can wrap on narrow screens without clipping their menus. */
  .bottombar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--pf-space-2);
    padding: var(--pf-space-2) var(--pf-space-3);
    background: var(--pf-surface);
    color: var(--pf-text);
    border-top: 1px solid var(--pf-border);
    min-height: 32px;
    box-sizing: border-box;
  }
  .bottombar .menu-popup {
    top: auto;
    bottom: calc(100% + 6px);
  }
  .filename {
    font-size: var(--pf-text-sm);
    font-weight: 600;
    color: var(--pf-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1 1 auto;
    min-width: 0;
  }
  .counter {
    font-size: var(--pf-text-xs);
    color: var(--pf-text-muted);
    font-variant-numeric: tabular-nums;
  }
`;

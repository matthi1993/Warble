import { css } from "lit";

export const contextMenuStyles = css`
  :host {
    display: contents;
  }
  .ctx-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
  }
  .ctx-menu {
    position: fixed;
    min-width: 180px;
    background: var(--pf-surface);
    color: var(--pf-text);
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-radius-md);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
    padding: var(--pf-space-1);
    font-size: var(--pf-text-sm);
    z-index: 1001;
  }
  .ctx-menu button {
    display: block;
    width: 100%;
    text-align: left;
    background: transparent;
    color: inherit;
    border: 0;
    padding: var(--pf-space-2) var(--pf-space-3);
    border-radius: var(--pf-radius-sm);
    font: inherit;
    cursor: pointer;
  }
  .ctx-menu button:hover,
  .ctx-menu button:focus-visible {
    background: var(--pf-surface-2);
    outline: none;
  }
  .ctx-menu button.danger {
    color: var(--pf-danger);
  }
  .ctx-menu .album-menu-list {
    max-height: min(240px, 40vh);
    overflow-y: auto;
    border-top: 1px solid var(--pf-border);
    margin-top: var(--pf-space-1);
    padding-top: var(--pf-space-1);
  }
  .ctx-menu .album-menu-empty {
    padding: var(--pf-space-2) var(--pf-space-3);
    color: var(--pf-text-muted);
  }
  @media (pointer: coarse) {
    .ctx-menu {
      min-width: 220px;
    }
    .ctx-menu button {
      min-height: 48px;
    }
  }
`;

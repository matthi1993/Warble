import { css } from "lit";

export const menuStyles = css`
  .menu-wrap {
    position: relative;
    display: inline-flex;
  }
  .menu-trigger {
    background: var(--pf-surface-2);
    color: var(--pf-text);
    border: 1px solid var(--pf-border);
    padding: 4px 10px;
    font-size: var(--pf-text-xs);
    font-weight: 600;
    border-radius: var(--pf-radius-md);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .menu-trigger:hover {
    background: var(--pf-surface-hover);
    border-color: var(--pf-accent);
  }
  .menu-trigger .swatch {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    border: 1px solid var(--pf-border-strong);
  }
  .menu-popup {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    background: var(--pf-surface);
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-radius-md);
    box-shadow: var(--pf-shadow-md);
    padding: 4px;
    z-index: 5;
    min-width: 140px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .settings-menu {
    width: min(300px, calc(100vw - 32px));
    min-width: 0;
    box-sizing: border-box;
    max-height: min(360px, calc(100vh - 96px));
    overflow-y: auto;
    gap: var(--pf-space-2);
    padding: var(--pf-space-2);
  }
  .view-menu {
    left: auto;
    right: 0;
  }
  .settings-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .settings-section-label {
    color: var(--pf-text-muted);
    font-size: var(--pf-text-xs);
    font-weight: 600;
  }
  .settings-options {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .settings-options .menu-item {
    background: var(--pf-surface-2);
    border: 1px solid var(--pf-border);
  }
  .settings-options .menu-item:hover {
    background: var(--pf-surface-hover);
  }
  .settings-options .menu-item[aria-pressed="true"] {
    background: var(--pf-accent-soft);
    border-color: var(--pf-accent);
  }
  .menu-item {
    background: transparent;
    color: var(--pf-text);
    border: none;
    padding: 6px 10px;
    text-align: left;
    font-size: var(--pf-text-xs);
    border-radius: var(--pf-radius-sm);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .menu-item:hover {
    background: var(--pf-surface-hover);
  }
  .menu-item[aria-pressed="true"] {
    background: var(--pf-accent-soft);
    color: var(--pf-accent);
  }
  .edit-mark {
    color: var(--pf-accent);
    font-weight: 700;
    line-height: 1;
  }
  .swatch {
    width: 1.4rem;
    height: 1.4rem;
    border-radius: var(--pf-radius-sm);
    border: 1px solid var(--pf-border-strong);
    cursor: pointer;
    padding: 0;
  }
`;

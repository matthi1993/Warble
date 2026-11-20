import { css } from "lit";

export const appSidebarStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
  }
  .sidebar-header {
    padding: var(--pf-space-2) var(--pf-space-2) 0;
    display: flex;
    flex-direction: column;
    gap: var(--pf-space-2);
    flex: 0 0 auto;
  }
  .sidebar-header .header-actions {
    display: inline-flex;
    align-items: center;
    gap: var(--pf-space-1);
    flex: 0 0 auto;
  }
  .sidebar-brand {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--pf-space-2);
    min-height: 36px;
    margin-bottom: var(--pf-space-3);
    font-weight: 700;
    letter-spacing: -0.03em;
  }
  .sidebar-brand-name {
    display: inline-flex;
    align-items: center;
    gap: var(--pf-space-2);
    min-width: 0;
  }
  .sidebar-brand img {
    width: 25px;
    height: 25px;
    border-radius: 7px;
  }
  .sidebar-navigation {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: var(--pf-space-2) var(--pf-space-2) var(--pf-space-4);
  }
  .nav-button {
    display: flex;
    align-items: center;
    gap: var(--pf-space-2);
    width: 100%;
    min-height: 36px;
    padding: var(--pf-space-2);
    border: 0;
    border-radius: var(--pf-radius-md);
    background: transparent;
    color: var(--pf-text);
    text-align: left;
    font: inherit;
    font-size: var(--pf-text-sm);
    cursor: pointer;
    transition: background var(--pf-transition), color var(--pf-transition);
  }
  .nav-button:hover { background: var(--pf-surface-hover); }
  .nav-button.active { background: var(--pf-accent-soft); color: var(--pf-accent-hover); }
  .nav-button:focus-visible {
    outline: 2px solid var(--pf-accent);
    outline-offset: -2px;
  }
  .nav-button > pf-icon { width: 17px; height: 17px; flex: 0 0 auto; }
  .nav-label { flex: 1; }
  .nav-count { margin-left: auto; color: var(--pf-text-muted); font-size: var(--pf-text-xs); }
  .nav-button > .nav-chevron {
    width: 14px;
    height: 14px;
    margin-left: auto;
    color: var(--pf-text-muted);
    transform: rotate(-90deg);
    transition: transform var(--pf-transition);
  }
  .nav-button[aria-expanded="true"] > .nav-chevron { transform: rotate(0); }
  .sidebar-footer {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--pf-space-2);
    padding: var(--pf-space-2);
    border-top: 1px solid var(--pf-border);
    background: var(--pf-surface);
  }
  .sidebar-settings { flex: 0 0 auto; }
  .sidebar-settings pf-button { width: 100%; }
`;

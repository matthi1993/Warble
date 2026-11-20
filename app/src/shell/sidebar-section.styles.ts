import { css } from "lit";

export const sidebarSectionStyles = css`
  :host {
    display: block;
    min-width: 0;
    margin: var(--pf-space-1) 0 var(--pf-space-2) var(--pf-space-3);
    padding: var(--pf-space-1) 0 var(--pf-space-1) var(--pf-space-2);
    border-left: 1px solid var(--pf-border);
    max-height: min(46vh, 420px);
    overflow-y: auto;
    scrollbar-width: thin;
  }
  :host([hidden]) { display: none; }
  .empty {
    color: var(--pf-text-subtle);
    font-size: var(--pf-text-sm);
    line-height: 1.5;
    padding: var(--pf-space-2);
  }
  .section-actions { padding: var(--pf-space-2) var(--pf-space-2) 0; }
  .add-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    gap: var(--pf-space-2);
    padding: var(--pf-space-2) var(--pf-space-3);
    border: 1px dashed var(--pf-border-strong);
    border-radius: var(--pf-radius-md);
    background: transparent;
    color: var(--pf-text-muted);
    font: inherit;
    font-size: var(--pf-text-sm);
    cursor: pointer;
    transition: background var(--pf-transition), border-color var(--pf-transition), color var(--pf-transition);
  }
  .add-button:hover {
    border-color: var(--pf-accent);
    background: var(--pf-accent-soft);
    color: var(--pf-accent-hover);
  }
  button:focus-visible {
    outline: 2px solid var(--pf-accent);
    outline-offset: -2px;
  }
`;

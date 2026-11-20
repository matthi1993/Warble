import { css } from "lit";

export const photoFilterPanelStyles = css`
  :host {
    display: block;
    /* Same width as the grid, so the breakpoints below match the grid's own container queries. */
    container-type: inline-size;
  }
  .filter-panel {
    display: flex;
    flex-direction: column;
    gap: var(--pf-space-2);
    padding: var(--pf-space-2) var(--pf-space-3);
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-radius-lg);
    background: var(--pf-surface, var(--pf-bg));
    box-shadow: none;
  }
  .label {
    font-size: var(--pf-text-xs);
    color: var(--pf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    flex: 0 0 auto;
  }
  .filter-toggle {
    display: flex;
    align-items: center;
    gap: var(--pf-space-2);
    width: 100%;
    min-height: 36px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--pf-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .filter-toggle pf-icon { margin-left: auto; }
  .filter-toggle[aria-expanded="false"] pf-icon { transform: rotate(-90deg); }
  .filter-status {
    font-size: var(--pf-text-xs);
    color: var(--pf-text-muted);
  }
  .filter-content {
    display: flex;
    flex-direction: column;
    gap: var(--pf-space-2);
  }
  .filter-content[hidden] { display: none; }
  .filter-controls {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--pf-space-3);
    align-items: end;
  }
  .filter-control {
    position: relative;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .filter-control select,
  .date-inputs input {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    min-height: 34px;
    padding: 5px 9px;
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-radius-md);
    background: var(--pf-surface-2);
    color: var(--pf-text);
    font: inherit;
    font-size: var(--pf-text-xs);
  }
  .filter-label {
    color: var(--pf-text-muted);
    font-size: var(--pf-text-xs);
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .select-wrap {
    position: relative;
    display: block;
  }
  .filter-control select {
    appearance: none;
    padding-right: 28px;
    cursor: pointer;
  }
  .filter-control select:hover {
    border-color: var(--pf-accent);
  }
  .filter-control select:focus-visible {
    outline: 2px solid var(--pf-accent);
    outline-offset: 1px;
  }
  .select-wrap pf-icon {
    position: absolute;
    top: 50%;
    right: 8px;
    width: 13px;
    height: 13px;
    color: var(--pf-text-muted);
    pointer-events: none;
    transform: translateY(-50%);
  }
  .date-range {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
    grid-column: span 2;
  }
  .date-inputs {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr));
    gap: var(--pf-space-2);
  }
  .date-inputs input {
    appearance: none;
    overflow: hidden;
  }
  .date-inputs input::-webkit-date-and-time-value {
    min-width: 0;
    text-align: left;
  }
  .date-inputs input::-webkit-datetime-edit {
    min-width: 0;
    padding: 0;
  }
  .filter-options {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--pf-space-3);
    border-top: 1px solid var(--pf-border);
    padding-top: var(--pf-space-2);
  }
  .filter-group {
    display: inline-flex;
    align-items: center;
    gap: var(--pf-space-2);
    color: var(--pf-text-muted);
    font-size: var(--pf-text-xs);
  }
  .type-filters { display: flex; flex-wrap: wrap; gap: 4px; }
  .type-filters button {
    padding: 6px 10px;
    min-height: 34px;
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-radius-md);
    background: var(--pf-surface-2);
    color: var(--pf-text-muted);
    font: inherit;
    cursor: pointer;
  }
  .type-filters button[aria-pressed="true"] {
    background: var(--pf-accent-soft);
    border-color: var(--pf-accent);
    color: var(--pf-accent-hover);
  }
  .type-filters button:focus-visible { outline: 2px solid var(--pf-accent); outline-offset: 2px; }
  .stars-filter {
    display: inline-flex;
    gap: 2px;
    cursor: pointer;
    user-select: none;
  }
  .stars-filter button {
    background: transparent;
    border: 0;
    color: var(--pf-text-muted);
    font-size: 16px;
    line-height: 1;
    padding: 2px 1px;
    cursor: pointer;
  }
  .stars-filter button.active {
    color: var(--pf-text);
  }
  .label-chips {
    display: inline-flex;
    gap: 4px;
  }
  .label-chips button {
    width: 16px;
    height: 16px;
    border-radius: 3px;
    border: 1px solid rgba(0, 0, 0, 0.2);
    cursor: pointer;
    padding: 0;
    opacity: 0.45;
    transition: opacity var(--pf-transition),
      transform var(--pf-transition);
  }
  .label-chips button:hover {
    opacity: 0.85;
  }
  .label-chips button.active {
    opacity: 1;
    transform: scale(1.12);
    box-shadow: 0 0 0 2px var(--pf-accent-soft, rgba(255, 255, 255, 0.2));
  }
  .filter-clear {
    padding: 3px 7px;
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-radius-sm);
    background: transparent;
    color: var(--pf-text-muted);
    font-size: var(--pf-text-xs);
    cursor: pointer;
    margin-left: auto;
  }
  .filter-clear:hover:not([disabled]) {
    color: var(--pf-text);
    border-color: var(--pf-text-muted);
  }
  .filter-clear[disabled] {
    opacity: 0.4;
    cursor: default;
  }
  @media (pointer: coarse) {
    .filter-toggle { min-height: 44px; }
    .filter-control select,
    .date-inputs input {
      min-height: 44px;
      font-size: 16px;
    }
    .stars-filter button { min-width: 32px; min-height: 44px; }
    .label-chips { gap: 8px; }
    .label-chips button { width: 28px; height: 36px; }
    .filter-clear, .type-filters button { min-height: 44px; }
  }
  @container (max-width: 800px) {
    .filter-controls {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @container (max-width: 430px) {
    .filter-controls {
      grid-template-columns: 1fr;
    }
    .date-range { grid-column: auto; }
    .filter-group { max-width: 100%; flex-wrap: wrap; }
  }
`;

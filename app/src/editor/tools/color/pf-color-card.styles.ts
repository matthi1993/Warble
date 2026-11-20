import { css } from "lit";

export const colorCardStyles = css`
  .body {
    padding: 8px 10px 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 4px 0;
  }
  .toggle-label {
    font-size: var(--pf-text-sm);
    color: var(--pf-text);
  }
  .toggle {
    position: relative;
    width: 36px;
    height: 20px;
    flex: 0 0 auto;
    border-radius: 999px;
    background: var(--pf-border);
    border: none;
    cursor: pointer;
    padding: 0;
    transition: background 120ms ease;
  }
  .toggle[aria-pressed="true"] {
    background: var(--pf-accent, #4a90e2);
  }
  .toggle::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: white;
    transition: transform 120ms ease;
  }
  .toggle[aria-pressed="true"]::after {
    transform: translateX(16px);
  }
  .tabs {
    display: flex;
    gap: 4px;
    background: var(--pf-surface);
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-radius-sm, 4px);
    padding: 2px;
  }
  .tab {
    flex: 1 1 0;
    font-size: var(--pf-text-xs);
    font-weight: 500;
    color: var(--pf-text-muted);
    background: transparent;
    border: none;
    border-radius: calc(var(--pf-radius-sm, 4px) - 2px);
    padding: 6px 4px;
    cursor: pointer;
    transition:
      background 80ms ease,
      color 80ms ease;
  }
  .tab:hover {
    color: var(--pf-text);
  }
  .tab[aria-selected="true"] {
    background: var(--pf-surface-hover);
    color: var(--pf-text);
  }
  .row {
    display: grid;
    grid-template-columns: 12px 1fr;
    column-gap: 8px;
    align-items: center;
  }
  .swatch {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.18);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35) inset;
  }
  pf-tone-slider-row {
    min-width: 0;
  }
  .divider {
    height: 1px;
    background: var(--pf-border);
    margin: 2px 0;
  }
  .global-label {
    font-size: var(--pf-text-xs);
    color: var(--pf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-top: 2px;
  }
`;

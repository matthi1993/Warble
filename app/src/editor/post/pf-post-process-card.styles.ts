import { css } from "lit";

export const postProcessCardStyles = css`
  :host,
  .stack {
    display: grid;
    align-content: start;
    gap: var(--pf-space-2);
  }
  .enable-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px;
    background: var(--pf-surface);
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-radius-sm, 4px);
  }
  .label {
    font-size: var(--pf-text-sm);
    font-weight: 500;
  }
  .dim {
    opacity: 0.5;
  }
`;

import { css } from "lit";

export const sliderRowStyles = css`
  .body {
    padding: 8px 10px 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 2px 8px;
    align-items: center;
  }
  .label {
    font-size: var(--pf-text-xs);
    color: var(--pf-text);
  }
  .value {
    font-size: var(--pf-text-xs);
    color: var(--pf-text-muted);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  pf-slider {
    grid-column: 1 / span 2;
    width: 100%;
  }
`;

export const steadyValueWidthStyles = css`
  .value {
    min-width: 3ch;
  }
`;

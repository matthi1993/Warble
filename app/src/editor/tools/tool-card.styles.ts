import { css } from "lit";

export const toolCardStyles = css`
  :host {
    display: block;
  }
  .card-revert {
    background: transparent;
    color: var(--pf-text-muted);
    border: none;
    border-left: 1px solid var(--pf-border);
    padding: 0 10px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .card-revert:hover {
    background: var(--pf-surface-hover);
    color: var(--pf-text);
  }
  .card-revert:disabled {
    opacity: 0.35;
    cursor: default;
  }
`;

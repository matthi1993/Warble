import { css } from "lit";

export const cropCardStyles = css`
  .edit-group {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    background: var(--pf-surface-2);
    border-radius: var(--pf-radius-md);
    flex-wrap: wrap;
  }
  .edit-group button {
    background: transparent;
    color: var(--pf-text);
    border: none;
    padding: 4px 10px;
    font-size: var(--pf-text-xs);
    font-weight: 600;
    border-radius: var(--pf-radius-sm);
    cursor: pointer;
    white-space: nowrap;
  }
  .edit-group button:hover {
    background: var(--pf-surface-hover);
  }
  .edit-group button[aria-pressed="true"] {
    background: var(--pf-accent-soft);
    color: var(--pf-accent);
  }
  .crop-tools-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--pf-space-3);
    margin-top: var(--pf-space-1);
  }
  .crop-tool-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: var(--pf-surface-2);
    color: var(--pf-text);
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-radius-md);
    cursor: pointer;
    transition:
      background 80ms ease,
      border-color 80ms ease;
  }
  .crop-tool-btn:hover {
    background: var(--pf-surface-hover);
    border-color: var(--pf-accent);
  }
  .crop-tool-btn[aria-pressed="true"] {
    background: var(--pf-accent-soft);
    border-color: var(--pf-accent);
    color: var(--pf-accent);
  }
  .crop-tool-btn pf-icon {
    width: 18px;
    height: 18px;
  }
  .rotation-row {
    display: flex;
    align-items: center;
    gap: var(--pf-space-2);
    margin-top: var(--pf-space-1);
  }
  .rotation-label {
    flex: 0 0 auto;
    font-size: var(--pf-text-xs);
    color: var(--pf-text-muted);
    min-width: 56px;
  }
  .rotation-value {
    flex: 0 0 auto;
    font-variant-numeric: tabular-nums;
    font-size: var(--pf-text-xs);
    min-width: 36px;
    text-align: right;
  }
  .rotation-row pf-slider {
    flex: 1 1 auto;
  }
  .card-revert pf-icon {
    font-size: 0.9rem;
  }
`;

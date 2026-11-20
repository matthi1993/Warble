import { css } from "lit";

export const postPresetsCardStyles = css`
  .body {
    padding: 8px 10px 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .empty {
    margin: 0;
    color: var(--pf-text-muted);
    font-size: var(--pf-text-xs);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .preset {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-radius-sm, 4px);
    overflow: hidden;
    background: var(--pf-surface);
  }
  .preset:hover,
  .preset.active {
    border-color: var(--pf-accent, #4a90e2);
  }
  .select,
  .delete {
    border: 0;
    background: transparent;
    color: var(--pf-text);
    cursor: pointer;
    touch-action: manipulation;
  }
  .select {
    min-width: 0;
    padding: 6px 8px;
    text-align: left;
    font-size: var(--pf-text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .preset.active .select {
    color: var(--pf-accent, #4a90e2);
    font-weight: 600;
  }
  .delete {
    display: grid;
    place-items: center;
    width: 30px;
    border-left: 1px solid var(--pf-border);
    color: var(--pf-text-muted);
  }
  .delete:hover {
    color: var(--pf-text);
    background: var(--pf-surface-hover);
  }
  .delete pf-icon {
    font-size: 0.85rem;
  }
  .save {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 6px;
    padding-top: 2px;
  }
  input {
    min-width: 0;
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-radius-sm, 4px);
    background: var(--pf-surface);
    color: var(--pf-text);
    padding: 6px 8px;
    font: inherit;
    font-size: var(--pf-text-xs);
    outline: none;
  }
  input:focus {
    border-color: var(--pf-accent, #4a90e2);
  }
  .save button {
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-radius-sm, 4px);
    background: var(--pf-surface);
    color: var(--pf-text);
    padding: 5px 9px;
    font-size: var(--pf-text-xs);
    cursor: pointer;
    touch-action: manipulation;
  }
  .save button:hover:not(:disabled) {
    background: var(--pf-surface-hover);
  }
  .save button:disabled {
    opacity: 0.4;
    cursor: default;
  }
`;

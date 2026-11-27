import { css } from "lit";

export const sidebarAlbumsStyles = css`
  .album-row {
    display: flex;
    align-items: center;
    gap: var(--pf-space-2);
    width: 100%;
    min-height: 34px;
    padding: var(--pf-space-2);
    box-sizing: border-box;
    border: 0;
    border-radius: var(--pf-radius-md);
    background: transparent;
    color: var(--pf-text);
    font: inherit;
    font-size: var(--pf-text-sm);
    text-align: left;
    cursor: pointer;
  }
  .album-row:hover, .album-row.drag-over { background: var(--pf-surface-hover); }
  .album-row.selected {
    background: var(--pf-accent-soft);
    color: var(--pf-accent-hover);
    box-shadow: inset 2px 0 var(--pf-accent);
  }
  .album-row.drag-over {
    background: rgba(35, 165, 85, .22);
    box-shadow: inset 0 0 0 2px #23a555;
  }
  .album-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .album-count { color: var(--pf-text-muted); font-size: var(--pf-text-xs); }
`;

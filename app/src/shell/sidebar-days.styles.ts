import { css } from "lit";

export const sidebarDaysStyles = css`
  .date-tree-row {
    display: flex;
    align-items: center;
    min-height: 30px;
    border-radius: var(--pf-radius-md);
    font-size: var(--pf-text-sm);
  }
  .date-tree-row:hover { background: var(--pf-surface-hover); }
  .date-tree-row.selected { background: var(--pf-accent-soft); color: var(--pf-accent-hover); box-shadow: inset 2px 0 var(--pf-accent); }
  .date-tree-row button { background: none; border: 0; color: inherit; cursor: pointer; font: inherit; }
  .date-tree-toggle { width: 24px; height: 30px; padding: 0; display: grid; place-items: center; }
  .date-tree-toggle pf-icon { width: 14px; height: 14px; }
  .date-tree-toggle[aria-expanded="false"] pf-icon { transform: rotate(-90deg); }
  .date-tree-label { flex: 1; min-width: 0; padding: var(--pf-space-1) var(--pf-space-2); text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .date-tree-count { color: var(--pf-text-muted); font-size: var(--pf-text-xs); padding-right: var(--pf-space-2); }
  .date-tree-children { padding-left: var(--pf-space-3); margin-top: 2px; }
  .date-tree-row.root .date-tree-label { font-weight: 600; }
`;

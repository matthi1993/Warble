import { css } from "lit";

export const editSidePanelStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-sizing: border-box;
    min-height: 0;
    width: 100%;
  }
  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    display: grid;
    grid-auto-rows: max-content;
    align-content: start;
    gap: var(--pf-space-2);
    padding: var(--pf-space-2);
  }
  .footer {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--pf-space-2);
    padding: var(--pf-space-2);
    border-top: 1px solid var(--pf-border);
    background: var(--pf-surface-2);
  }
  .footer[hidden] {
    display: none;
  }
`;

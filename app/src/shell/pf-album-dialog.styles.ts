import { css } from "lit";

export const albumDialogStyles = css`
  :host {
    display: contents;
  }
  .album-dialog-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10001;
    display: grid;
    place-items: center;
    padding: var(--pf-space-3);
    background: rgba(0, 0, 0, 0.55);
  }
  .album-dialog {
    display: flex;
    flex-direction: column;
    gap: var(--pf-space-3);
    width: min(100%, 400px);
    box-sizing: border-box;
    padding: var(--pf-space-4);
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-radius-lg);
    background: var(--pf-surface);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.3);
  }
  .album-dialog h2 { margin: 0; font-size: var(--pf-text-lg); }
  .album-dialog label { display: flex; flex-direction: column; gap: var(--pf-space-1); font-size: var(--pf-text-sm); }
  .album-dialog input, .album-dialog textarea {
    box-sizing: border-box;
    width: 100%;
    padding: var(--pf-space-2);
    border: 1px solid var(--pf-border-strong);
    border-radius: var(--pf-radius-md);
    background: var(--pf-surface-2);
    color: var(--pf-text);
    font: inherit;
  }
  .album-dialog textarea { min-height: 85px; resize: vertical; }
  .album-dialog-actions { display: flex; justify-content: flex-end; gap: var(--pf-space-2); }
  .album-dialog-actions button {
    padding: var(--pf-space-2) var(--pf-space-3);
    border: 1px solid var(--pf-border-strong);
    border-radius: var(--pf-radius-md);
    background: var(--pf-surface-2);
    color: var(--pf-text);
    font: inherit;
    cursor: pointer;
  }
  .album-dialog-actions button[type="submit"] { background: var(--pf-accent); color: white; border-color: var(--pf-accent); }
  .album-error { margin: 0; color: var(--pf-danger, #e86a6a); font-size: var(--pf-text-sm); }
`;

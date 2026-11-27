import { css } from "lit";

export const libraryPlaceholderStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
  }
  h1 {
    margin: 0 0 var(--pf-space-4);
    font-size: var(--pf-text-xl);
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  p {
    color: var(--pf-text-muted);
    font-size: var(--pf-text-sm);
  }
  :host > p {
    flex: 0 0 auto;
  }
  .welcome {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    place-items: center;
    text-align: center;
  }
  .welcome-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--pf-space-3);
    max-width: 360px;
    padding: var(--pf-space-5);
  }
  .welcome img {
    width: clamp(88px, 14vw, 132px);
    height: auto;
    border-radius: 22%;
    box-shadow: var(--pf-shadow-md);
  }
  .welcome h1,
  .welcome p {
    margin: 0;
  }
  .welcome h1 {
    font-size: var(--pf-text-xl);
  }
  .welcome p {
    max-width: 30ch;
    line-height: 1.5;
  }
  .empty-content-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--pf-space-3);
    padding: var(--pf-space-3) var(--pf-space-1) var(--pf-space-2);
    border-bottom: 1px solid var(--pf-border);
  }
  .empty-content-header h1 {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--pf-text-xl);
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .include-subfolders-toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--pf-space-2);
    flex: 0 0 auto;
    color: var(--pf-text-muted);
    font-size: var(--pf-text-xs);
    cursor: pointer;
    user-select: none;
  }
  .include-subfolders-toggle input {
    margin: 0;
    accent-color: var(--pf-accent);
    cursor: pointer;
  }
`;

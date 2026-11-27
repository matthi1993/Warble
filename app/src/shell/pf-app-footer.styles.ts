import { css } from "lit";

export const appFooterStyles = css`
  :host {
    display: flex;
    align-items: center;
    gap: var(--pf-space-3);
    flex: 1 1 auto;
    min-width: 0;
  }
  .footer-label {
    flex-shrink: 0;
  }
  .footer-task-spinner {
    width: 11px;
    height: 11px;
    box-sizing: border-box;
    flex: 0 0 auto;
    border: 2px solid var(--pf-border);
    border-top-color: var(--pf-accent);
    border-radius: 50%;
    animation: footer-task-spin 0.75s linear infinite;
  }
  @keyframes footer-task-spin {
    to { transform: rotate(360deg); }
  }
  .footer-details {
    min-height: 24px;
    padding: 2px 8px;
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-radius-sm);
    background: transparent;
    color: var(--pf-text-muted);
    font: inherit;
    cursor: pointer;
  }
  .footer-details:hover {
    border-color: var(--pf-accent);
    color: var(--pf-text);
  }
  .footer-task-details-wrap {
    position: relative;
    display: inline-flex;
  }
  @media (prefers-reduced-motion: reduce) {
    .footer-task-spinner { animation-duration: 1.5s; }
  }
  .footer-spacer {
    flex: 1;
  }
`;

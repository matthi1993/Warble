import { css } from "lit";

export const editFooterStyles = css`
  .edit-footer {
    display: flex;
    flex-direction: column;
    gap: var(--pf-space-2);
    width: 100%;
    min-width: 0;
  }
  .edit-footer-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--pf-space-2);
  }
  .footer-btn {
    background: var(--pf-surface);
    color: var(--pf-text);
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-radius-md);
    padding: 4px 10px;
    font-size: var(--pf-text-xs);
    font-weight: 600;
    cursor: pointer;
    display: inline-flex;
    justify-content: center;
    min-width: 0;
    align-items: center;
    gap: 6px;
    touch-action: manipulation;
    transition: background var(--pf-transition);
  }
  .footer-btn:hover {
    background: var(--pf-surface-hover);
    border-color: var(--pf-accent);
  }
  .footer-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .footer-btn:disabled:hover {
    background: var(--pf-surface);
    border-color: var(--pf-border);
  }
  .footer-btn[aria-busy="true"] {
    opacity: 1;
    cursor: progress;
  }
  .footer-btn[aria-pressed="true"] {
    background: var(--pf-accent);
    color: var(--pf-on-accent);
    border-color: transparent;
  }
  .footer-btn pf-icon {
    font-size: 0.95rem;
    flex: 0 0 auto;
  }
  .footer-btn-spinner {
    width: 0.8rem;
    height: 0.8rem;
    box-sizing: border-box;
    flex: 0 0 auto;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: footer-btn-spin 0.7s linear infinite;
  }
  @keyframes footer-btn-spin {
    to { transform: rotate(360deg); }
  }
  .footer-btn span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .footer-btn.danger:not(:disabled) {
    color: var(--pf-danger, #d14a4a);
    background: color-mix(in srgb, var(--pf-danger, #d14a4a) 10%, var(--pf-surface));
    border-color: color-mix(in srgb, var(--pf-danger, #d14a4a) 45%, var(--pf-border));
  }
  .footer-btn.danger:not(:disabled):hover {
    color: var(--pf-danger, #e05252);
    background: color-mix(in srgb, var(--pf-danger, #d14a4a) 18%, var(--pf-surface));
    border-color: var(--pf-danger, #d14a4a);
  }
`;

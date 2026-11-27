import { css } from "lit";

export const busyOverlayStyles = css`
  :host {
    display: contents;
  }
  .app-busy-overlay {
    position: fixed;
    inset: 0;
    z-index: 10000;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--pf-bg) 72%, transparent);
    backdrop-filter: blur(2px);
    cursor: wait;
  }
  .app-busy-status {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--pf-space-3);
    padding: var(--pf-space-4) var(--pf-space-5);
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-radius-lg);
    background: var(--pf-surface);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
    color: var(--pf-text);
    font-size: var(--pf-text-sm);
  }
  .app-busy-spinner {
    width: 28px;
    height: 28px;
    box-sizing: border-box;
    border: 3px solid var(--pf-border);
    border-top-color: var(--pf-accent);
    border-radius: 50%;
    animation: app-busy-spin 0.75s linear infinite;
  }
  @keyframes app-busy-spin {
    to { transform: rotate(360deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    .app-busy-spinner { animation-duration: 1.5s; }
  }
`;

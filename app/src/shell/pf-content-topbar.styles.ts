import { css } from "lit";

export const contentTopbarStyles = css`
  :host {
    display: block;
    flex: 0 0 auto;
    min-width: 0;
  }
  .content-topbar {
    display: flex;
    align-items: center;
    gap: var(--pf-space-2);
    min-height: 46px;
    border-bottom: 1px solid var(--pf-border);
    color: var(--pf-text-muted);
    font-size: var(--pf-text-xs);
    white-space: nowrap;
    overflow: hidden;
  }
  .content-topbar pf-icon { flex: 0 0 auto; }
  .breadcrumb-current {
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--pf-text);
  }
  .breadcrumb-separator { color: var(--pf-text-subtle); }
  .mobile-menu-button, .detail-toggle { display: none; }
  .topbar-spacer { flex: 1; }
  .detail-toggle {
    align-items: center;
    justify-content: center;
    gap: var(--pf-space-1);
    min-height: 34px;
    padding: 0 var(--pf-space-2);
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-radius-md);
    background: var(--pf-surface);
    color: var(--pf-text);
    font: inherit;
    cursor: pointer;
    flex: 0 0 auto;
  }
  @media (max-width: 1080px) {
    .detail-toggle { display: inline-flex; }
  }
  @media (max-width: 700px) {
    .mobile-menu-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      flex: 0 0 auto;
      border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-md);
      background: var(--pf-surface);
      color: var(--pf-text);
      font: inherit;
    }
    .content-topbar { min-height: 52px; }
  }
`;

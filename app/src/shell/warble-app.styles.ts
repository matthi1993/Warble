import { css } from "lit";

export const warbleAppStyles = css`
  :host {
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    grid-template-columns: 36px 260px minmax(0, 1fr) 304px;
    grid-template-areas:
      "rail sidebar main detail"
      "footer footer footer footer";
    width: 100%;
    height: 100%;
    max-height: 100%;
    min-height: 0;
    overflow: hidden;
    padding-top: env(safe-area-inset-top);
    padding-right: env(safe-area-inset-right);
    padding-left: env(safe-area-inset-left);
    background: var(--pf-bg);
    color: var(--pf-text);
    font-family: var(--pf-font-sans);
    font-size: var(--pf-text-base);
  }
  :host(.sidebar-collapsed) {
    grid-template-columns: 36px 0 minmax(0, 1fr) 304px;
  }
  :host(.sidebar-collapsed) aside.sidebar {
    display: none;
  }
  :host(.fs-fullview), :host(.fs-fullview.sidebar-collapsed) {
    position: relative;
    grid-template-rows: minmax(0, 1fr) auto;
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: "fullview" "footer";
    padding: 0;
    --pf-fullview-left-inset: 296px;
  }
  :host(.fs-fullview.sidebar-collapsed) {
    --pf-fullview-left-inset: 36px;
  }
  :host(.fs-fullview) > .sidebar-rail {
    position: absolute;
    inset: 0 auto 0 0;
    width: 36px;
    z-index: 40;
  }
  :host(.fs-fullview) > aside.sidebar {
    position: absolute;
    inset: 0 auto 0 36px;
    width: 260px;
    z-index: 40;
  }
  :host(.fs-fullview.fs-controls-hidden) > .sidebar-rail,
  :host(.fs-fullview.fs-controls-hidden) > aside.sidebar {
    opacity: 0;
    pointer-events: none;
  }
  :host(.fs-fullview) > main.content,
  :host(.fs-fullview) > aside.detail,
  :host(.fs-fullview) > footer.app-footer {
    display: none;
  }
  :host(.fs-fullview) > pf-full-view {
    grid-area: fullview;
    grid-row: 1;
    grid-column: 1;
  }
  /* The rail keeps its column while the sidebar is collapsed, so the toggle never overlaps the content. */
  .sidebar-rail {
    grid-area: rail;
    background: var(--pf-surface);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-top: var(--pf-space-3);
    box-sizing: border-box;
  }
  aside.sidebar {
    grid-area: sidebar;
    border-right: 1px solid var(--pf-border);
    background: var(--pf-surface);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
  }
  .photo-drag-preview {
    position: fixed;
    z-index: 1500;
    pointer-events: none;
    transform: translate(12px, 12px);
    padding: 8px 12px;
    border-radius: var(--pf-radius-sm);
    background: var(--pf-surface);
    color: var(--pf-text);
    box-shadow: var(--pf-shadow-md);
    border: 1px solid #23a555;
    font-size: var(--pf-text-sm);
  }
  main.content {
    grid-area: main;
    margin: 0;
    padding: 0 var(--pf-space-4) var(--pf-space-3);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }
  .mobile-backdrop, .detail-backdrop { display: none; }
  main.content > pf-photo-grid {
    flex: 1 1 auto;
    min-height: 0;
  }
  aside.detail {
    grid-area: detail;
    margin: var(--pf-space-3) var(--pf-space-3) var(--pf-space-2) 0;
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-radius-lg);
    overflow: hidden;
    min-width: 0;
  }
  pf-full-view {
    grid-row: 1;
    grid-column: 3 / -1;
    min-width: 0;
    min-height: 0;
  }
  footer.app-footer {
    grid-area: footer;
    position: relative;
    z-index: 50;
    display: flex;
    align-items: center;
    gap: var(--pf-space-3);
    padding-top: 0;
    padding-right: var(--pf-space-4);
    padding-bottom: env(safe-area-inset-bottom);
    padding-left: var(--pf-space-4);
    border-top: 1px solid var(--pf-border);
    background: var(--pf-surface);
    color: var(--pf-text-muted);
    font-size: var(--pf-text-xs);
    min-height: 44px;
  }
  @media (pointer: coarse) {
    :host {
      grid-template-columns: 44px 260px minmax(0, 1fr) 304px;
    }
    :host(.sidebar-collapsed) {
      grid-template-columns: 44px 0 minmax(0, 1fr) 304px;
    }
    :host(.fs-fullview), :host(.fs-fullview.sidebar-collapsed) {
      grid-template-columns: minmax(0, 1fr);
      --pf-fullview-left-inset: 304px;
    }
    :host(.fs-fullview.sidebar-collapsed) { --pf-fullview-left-inset: 44px; }
    :host(.fs-fullview) > .sidebar-rail { width: 44px; }
    :host(.fs-fullview) > aside.sidebar { left: 44px; }
  }
  @media (max-width: 1080px) {
    :host, :host(.sidebar-collapsed) {
      grid-template-columns: 36px 260px minmax(0, 1fr);
      grid-template-areas: "rail sidebar main" "footer footer footer";
    }
    :host(.sidebar-collapsed) { grid-template-columns: 36px 0 minmax(0, 1fr); }
    :host(.fs-fullview), :host(.fs-fullview.sidebar-collapsed) {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas: "fullview" "footer";
    }
    aside.detail { display: none; }
    :host(.detail-open) aside.detail {
      display: block;
      position: fixed;
      z-index: 1101;
      inset: env(safe-area-inset-top) 0 0 auto;
      width: min(360px, 90vw);
      margin: 0;
      border-radius: var(--pf-radius-lg) 0 0 var(--pf-radius-lg);
      box-shadow: -12px 0 36px rgba(0,0,0,.35);
    }
    .detail-backdrop {
      position: fixed;
      z-index: 1100;
      inset: 0;
      background: rgba(0,0,0,.55);
    }
    :host(.detail-open) .detail-backdrop { display: block; }
    pf-full-view { grid-column: 3; }
  }
  @media (pointer: coarse) and (min-width: 701px) and (max-width: 1080px) {
    :host { grid-template-columns: 44px 260px minmax(0, 1fr); }
    :host(.sidebar-collapsed) { grid-template-columns: 44px 0 minmax(0, 1fr); }
    :host(.fs-fullview), :host(.fs-fullview.sidebar-collapsed) {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (max-width: 700px) {
    :host, :host(.sidebar-collapsed) {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas: "main" "footer";
    }
    :host > .sidebar-rail, :host > aside.sidebar { display: none; }
    :host(.fs-fullview) { --pf-fullview-left-inset: 0px; }
    :host(.mobile-sidebar-open) > aside.sidebar {
      display: flex;
      position: fixed;
      z-index: 1101;
      inset: env(safe-area-inset-top) auto 0 0;
      width: min(300px, 84vw);
      box-shadow: 12px 0 36px rgba(0,0,0,.35);
    }
    .mobile-backdrop {
      position: fixed;
      z-index: 1100;
      inset: 0;
      background: rgba(0,0,0,.55);
    }
    :host(.mobile-sidebar-open) .mobile-backdrop { display: block; }
    main.content { padding: 0 var(--pf-space-3) var(--pf-space-2); }
    pf-full-view { grid-column: 1; }
    footer.app-footer { padding-inline: var(--pf-space-3); }
    :host(.fs-fullview) {
      grid-template-rows: minmax(0, 1fr) auto;
      grid-template-areas: "fullview" "footer";
    }
    :host(.fs-fullview) > .mobile-backdrop { display: none; }
    :host(.fs-fullview) > .detail-backdrop { display: none; }
  }
`;

import { css } from "lit";

export const fullViewStyles = css`
  :host {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--pf-fv-bg, #000);
    color: var(--pf-fv-fg, #fff);
    outline: none;
    overflow: hidden;
  }
  :host([presenting]),
  :host([presenting]) * {
    cursor: none !important;
  }
  .toolbar-wrap,
  .bottombar-wrap {
    position: relative;
    z-index: 30;
    transition: opacity 200ms ease;
  }
  :host([immersive]) .toolbar-wrap,
  :host([immersive]) .bottombar-wrap {
    position: absolute;
    left: var(--pf-fullview-left-inset, 0px);
    right: 0;
  }
  :host([immersive]) .toolbar-wrap { top: 0; }
  :host([immersive]) .bottombar-wrap { bottom: 0; }
  :host([immersive][controls-hidden]) .toolbar-wrap,
  :host([immersive][controls-hidden]) .bottombar-wrap {
    opacity: 0;
    pointer-events: none;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--pf-space-2);
    padding: var(--pf-space-2) var(--pf-space-3);
    background: var(--pf-surface);
    color: var(--pf-text);
    border-bottom: 1px solid var(--pf-border);
  }
  .toolbar-left,
  .toolbar-right {
    display: flex;
    align-items: center;
    gap: var(--pf-space-2);
    flex: 1 1 0;
    min-width: 0;
  }
  .toolbar-right {
    justify-content: flex-end;
  }
  .toolbar-center {
    display: flex;
    align-items: center;
    gap: var(--pf-space-2);
    flex: 0 0 auto;
  }
  /* View controls can wrap on narrow screens without clipping their menus. */
  .bottombar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--pf-space-2);
    padding: var(--pf-space-2) var(--pf-space-3);
    background: var(--pf-surface);
    color: var(--pf-text);
    border-top: 1px solid var(--pf-border);
    min-height: 32px;
    box-sizing: border-box;
  }
  .bottombar .menu-popup {
    top: auto;
    bottom: calc(100% + 6px);
  }
  .filename {
    font-size: var(--pf-text-sm);
    font-weight: 600;
    color: var(--pf-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1 1 auto;
    min-width: 0;
  }
  .counter {
    font-size: var(--pf-text-xs);
    color: var(--pf-text-muted);
    font-variant-numeric: tabular-nums;
  }
  .menu-wrap {
    position: relative;
    display: inline-flex;
  }
  .menu-trigger {
    background: var(--pf-surface-2);
    color: var(--pf-text);
    border: 1px solid var(--pf-border);
    padding: 4px 10px;
    font-size: var(--pf-text-xs);
    font-weight: 600;
    border-radius: var(--pf-radius-md);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .menu-trigger:hover {
    background: var(--pf-surface-hover);
    border-color: var(--pf-accent);
  }
  .menu-trigger .swatch {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    border: 1px solid var(--pf-border-strong);
  }
  .menu-popup {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    background: var(--pf-surface);
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-radius-md);
    box-shadow: var(--pf-shadow-md);
    padding: 4px;
    z-index: 5;
    min-width: 140px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .settings-menu {
    width: min(300px, calc(100vw - 32px));
    min-width: 0;
    box-sizing: border-box;
    max-height: min(360px, calc(100vh - 96px));
    overflow-y: auto;
    gap: var(--pf-space-2);
    padding: var(--pf-space-2);
  }
  .view-menu {
    left: auto;
    right: 0;
  }
  .settings-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .settings-section-label {
    color: var(--pf-text-muted);
    font-size: var(--pf-text-xs);
    font-weight: 600;
  }
  .settings-options {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .settings-options .menu-item {
    background: var(--pf-surface-2);
    border: 1px solid var(--pf-border);
  }
  .settings-options .menu-item:hover {
    background: var(--pf-surface-hover);
  }
  .settings-options .menu-item[aria-pressed="true"] {
    background: var(--pf-accent-soft);
    border-color: var(--pf-accent);
  }
  .menu-item {
    background: transparent;
    color: var(--pf-text);
    border: none;
    padding: 6px 10px;
    text-align: left;
    font-size: var(--pf-text-xs);
    border-radius: var(--pf-radius-sm);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .menu-item:hover {
    background: var(--pf-surface-hover);
  }
  .menu-item[aria-pressed="true"] {
    background: var(--pf-accent-soft);
    color: var(--pf-accent);
  }
  .edit-mark {
    color: var(--pf-accent);
    font-weight: 700;
    line-height: 1;
  }
  .swatch {
    width: 1.4rem;
    height: 1.4rem;
    border-radius: var(--pf-radius-sm);
    border: 1px solid var(--pf-border-strong);
    cursor: pointer;
    padding: 0;
  }
  .stage {
    flex: 1;
    position: relative;
    overflow: hidden;
    background: var(--pf-fv-bg, #000);
    min-height: 0;
  }
  /* Row that holds the stage and the floating side panel. */
  .stage-row {
    flex: 1;
    display: flex;
    min-height: 0;
    min-width: 0;
    position: relative;
  }
  :host([immersive]) .stage-row {
    position: absolute;
    inset: 0;
  }
  pf-image-canvas {
    position: absolute;
    inset: 0;
  }
  .slideshow-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: none;
    pointer-events: none;
    z-index: 2;
  }
  .slideshow-settings {
    display: flex;
    flex-direction: column;
    gap: var(--pf-space-2);
    padding: var(--pf-space-3);
    font-size: var(--pf-text-sm);
  }
  .slideshow-settings h2 { margin: 0 0 var(--pf-space-2); font-size: var(--pf-text-base); }
  .slideshow-settings select, .slideshow-settings input {
    box-sizing: border-box;
    width: 100%;
    min-height: 34px;
    padding: 5px 9px;
    color: var(--pf-text);
    background: var(--pf-surface-2);
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-radius-md);
    font: inherit;
    font-size: var(--pf-text-xs);
  }
  .slideshow-settings label {
    color: var(--pf-text-muted);
    font-size: var(--pf-text-xs);
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .slideshow-select-wrap { position: relative; display: block; }
  .slideshow-settings select { appearance: none; padding-right: 28px; cursor: pointer; }
  .slideshow-settings select:hover { border-color: var(--pf-accent); }
  .slideshow-settings select:focus-visible {
    outline: 2px solid var(--pf-accent);
    outline-offset: 1px;
  }
  .slideshow-select-wrap pf-icon {
    position: absolute;
    top: 50%;
    right: 8px;
    width: 13px;
    height: 13px;
    color: var(--pf-text-muted);
    pointer-events: none;
    transform: translateY(-50%);
  }
  .slideshow-settings button {
    cursor: pointer;
    margin-top: var(--pf-space-3);
    padding: var(--pf-space-2);
    color: var(--pf-text);
    background: var(--pf-surface-2);
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-radius-sm);
  }
  .slideshow-settings button pf-icon { vertical-align: middle; }
  .fv-rating-overlay {
    position: absolute;
    inset: 0;
    z-index: 11;
    pointer-events: none;
  }
  :host([immersive][controls-hidden]) .fv-rating-overlay {
    visibility: hidden;
  }
  .close-btn {
    background: var(--pf-surface-2);
    color: var(--pf-text);
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-radius-md);
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
  }
  .close-btn:hover {
    background: var(--pf-surface-hover);
    border-color: var(--pf-accent);
  }
  .close-btn svg {
    width: 18px;
    height: 18px;
    stroke: currentColor;
    stroke-width: 2;
    fill: none;
  }
  pf-edit-side-panel {
    flex: 0 0 280px;
    max-width: 90vw;
    background: var(--pf-surface);
    border-left: 1px solid var(--pf-border);
    color: var(--pf-text);
  }
  .edit-side-rail {
    flex: 0 0 32px;
    border-left: 1px solid var(--pf-border);
    background: var(--pf-surface);
    color: var(--pf-text);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--pf-space-1);
    padding-top: var(--pf-space-2);
    box-sizing: border-box;
    transition: opacity 200ms ease;
  }
  .edit-side-rail pf-icon-button[aria-pressed="true"] {
    color: var(--pf-accent);
  }
  :host(:not([edit-panel-open])) pf-edit-side-panel {
    display: none;
  }
  :host([immersive]) .edit-side-rail,
  :host([immersive]) pf-edit-side-panel {
    position: absolute;
    top: var(--pf-fv-toolbar-height, 48px);
    bottom: var(--pf-fv-footer-height, 48px);
    right: 0;
    z-index: 12;
    box-sizing: border-box;
  }
  :host([immersive]) .edit-side-rail {
    width: 32px;
  }
  :host([immersive][edit-panel-open]) .edit-side-rail {
    right: min(280px, 90vw);
  }
  :host([immersive]) pf-edit-side-panel {
    width: min(280px, 90vw);
  }
  :host([immersive][controls-hidden]) .edit-side-rail,
  :host([immersive][controls-hidden]) pf-edit-side-panel {
    opacity: 0;
    pointer-events: none;
  }
  .edit-enable-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px;
    background: var(--pf-surface);
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-radius-sm, 4px);
    font-size: var(--pf-text-sm);
  }
  .edit-tool-stack { display: flex; flex-direction: column; gap: var(--pf-space-2); }
  .edit-tool-stack.dim { opacity: 0.5; }
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
  /* Footer buttons inside the slotted side-panel footer. */
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

  /* iPad/touch refinements: retain the visual design while meeting Apple's
     44pt target size and respecting the home indicator/notch safe areas. */
  @media (pointer: coarse) {
    :host([immersive]) .toolbar {
      padding-top: max(var(--pf-space-2), env(safe-area-inset-top));
      padding-left: max(var(--pf-space-3), env(safe-area-inset-left));
      padding-right: max(var(--pf-space-3), env(safe-area-inset-right));
    }
    :host([immersive]) .bottombar {
      padding-bottom: max(var(--pf-space-2), env(safe-area-inset-bottom));
      padding-left: max(var(--pf-space-3), env(safe-area-inset-left));
      padding-right: max(var(--pf-space-3), env(safe-area-inset-right));
    }
    .nav {
      width: 48px;
      height: 48px;
    }
    .close-btn,
    .menu-trigger,
    .menu-item,
    .footer-btn {
      min-height: 44px;
    }
    .hint {
      display: none;
    }
    .edit-side-rail {
      flex-basis: 44px;
      width: 44px;
    }
    :host([immersive]) .edit-side-rail {
      width: 44px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .footer-btn-spinner {
      animation-duration: 1.4s;
    }
  }
`;

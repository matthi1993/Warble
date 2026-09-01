/**
 * Styles for `<pf-full-view>`. Extracted from `full-view.ts` to keep
 * the orchestrator focused on logic. Includes toolbar / bottombar /
 * stage / edit rail / footer-button styling.
 *
 * Card-specific styling (info / crop / basic / tone slider) lives
 * inside each sub-component.
 *
 * Fullscreen philosophy: the host app-shell collapses its grid so
 * that `pf-full-view` fills the entire window. The layout inside is
 * identical to windowed mode — same flex column (toolbar →
 * stage-row → bottombar), same edit panel on the right. The only
 * difference is that all chrome (toolbar, bottombar, nav, hint,
 * edit rail/panel) fades out when the cursor is idle, and
 * reappears when the cursor approaches a screen edge or hovers
 * over a chrome element.
 */
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
  /* In fullscreen the host element is positioned to fill the
     entire window by the app-shell grid — no position:fixed here
     so the normal flex layout works inside. */
  :host([fullscreen]) {
    position: absolute;
    inset: 0;
    z-index: 1000;
    overflow: hidden;
  }
  .toolbar,
  .bottombar,
  .nav,
  .hint {
    transition: opacity 200ms ease;
  }
  /* In fullscreen, chrome overlays the image instead of taking
     up flex space, so the image fills the entire viewport. */
  :host([fullscreen]) .toolbar-wrap {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 10;
  }
  :host([fullscreen]) .bottombar-wrap {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 10;
  }
  :host([fullscreen]) .nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 10;
  }
  :host([fullscreen]) .nav.prev {
    left: 12px;
  }
  :host([fullscreen]) .nav.next {
    right: 12px;
  }
  :host([fullscreen]) .stage-row {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  :host([fullscreen]) .stage {
    position: absolute;
    inset: 0;
  }
  /* Fade out all chrome when idle in fullscreen. */
  :host([fullscreen][idle]) .toolbar-wrap,
  :host([fullscreen][idle]) .bottombar-wrap,
  :host([fullscreen][idle]) .nav,
  :host([fullscreen][idle]) .hint {
    opacity: 0;
    pointer-events: none;
  }
  /* Touch fullscreen uses explicit taps rather than cursor idleness. */
  :host([fullscreen][controls-hidden]) .toolbar-wrap,
  :host([fullscreen][controls-hidden]) .bottombar-wrap,
  :host([fullscreen][controls-hidden]) .nav,
  :host([fullscreen][controls-hidden]) .hint,
  :host([fullscreen][controls-hidden]) .edit-side-rail,
  :host([fullscreen][controls-hidden]) pf-edit-side-panel,
  :host([fullscreen][controls-hidden]) .fv-rating-overlay {
    opacity: 0;
    pointer-events: none;
  }
  :host([fullscreen][idle]) {
    cursor: none;
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
  :host([fullscreen]) .toolbar {
    background: color-mix(in srgb, var(--pf-surface) 88%, transparent);
    backdrop-filter: blur(8px);
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
  /* Symmetric placeholder bar at the bottom — same vertical footprint
     as the toolbar so the stage's centre lines up with the viewport's
     centre. When the toolbar fades on idle, this bar fades with it. */
  .bottombar {
    display: flex;
    align-items: center;
    gap: var(--pf-space-2);
    padding: var(--pf-space-2) var(--pf-space-3);
    background: var(--pf-surface);
    color: var(--pf-text);
    border-top: 1px solid var(--pf-border);
    min-height: 32px;
    box-sizing: border-box;
  }
  :host([fullscreen]) .bottombar {
    background: color-mix(in srgb, var(--pf-surface) 88%, transparent);
    backdrop-filter: blur(8px);
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
  .format-switch {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    background: var(--pf-surface-2);
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-radius-md);
  }
  .format-switch button {
    background: transparent;
    color: var(--pf-text);
    border: none;
    padding: 2px 10px;
    font-size: var(--pf-text-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    border-radius: var(--pf-radius-sm);
    cursor: pointer;
    white-space: nowrap;
  }
  .format-switch button[aria-pressed="true"] {
    background: var(--pf-accent-soft);
    color: var(--pf-accent);
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
  pf-image-canvas {
    position: absolute;
    inset: 0;
  }
  .fv-rating-overlay {
    position: absolute;
    bottom: var(--pf-space-3);
    right: var(--pf-space-3);
    z-index: 6;
    pointer-events: none;
  }
  .nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 6;
    background: color-mix(in srgb, var(--pf-surface) 70%, transparent);
    border: 1px solid var(--pf-border);
    color: var(--pf-text);
    border-radius: var(--pf-radius-full, 999px);
    width: 36px;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    backdrop-filter: blur(4px);
  }
  .nav.prev {
    left: var(--pf-space-2);
  }
  .nav.next {
    right: var(--pf-space-2);
  }
  .nav:hover {
    background: var(--pf-surface-hover);
    border-color: var(--pf-accent);
  }
  .nav:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .nav pf-icon {
    font-size: 1.1rem;
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
  .hint {
    position: absolute;
    bottom: var(--pf-space-3);
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.6);
    color: rgba(255, 255, 255, 0.85);
    font-size: var(--pf-text-xs);
    padding: 4px 10px;
    border-radius: var(--pf-radius-sm);
    pointer-events: none;
    opacity: 0;
    transition: opacity 200ms ease;
  }
  .stage:hover .hint {
    opacity: 1;
  }
  /* Right-side editor panel: in the flex flow alongside the stage
     in both windowed and fullscreen modes. */
  pf-edit-side-panel {
    flex: 0 0 280px;
    max-width: 90vw;
    background: var(--pf-surface);
    border-left: 1px solid var(--pf-border);
    color: var(--pf-text);
  }
  /* Permanent thin rail that hosts the panel's tab toggles. */
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
  }
  .edit-side-rail pf-icon-button[aria-pressed="true"] {
    color: var(--pf-accent);
  }
  /* Panel is shown only when the user has explicitly expanded it
     (a tab is active). */
  :host(:not([edit-panel-open])) pf-edit-side-panel {
    display: none;
  }
  /* In fullscreen, float over the stage. Hidden by default,
     only revealed when the cursor approaches the right edge. */
  :host([fullscreen]) .edit-side-rail,
  :host([fullscreen]) pf-edit-side-panel {
    position: absolute;
    top: 0;
    bottom: 0;
    flex: none;
    z-index: 9;
    background: color-mix(in srgb, var(--pf-surface) 92%, transparent);
    backdrop-filter: blur(8px);
    opacity: 0;
    pointer-events: none;
    transform: translateX(8px);
    transition: opacity 200ms ease, transform 200ms ease;
  }
  /* Offset below toolbar / above bottombar when visible. */
  :host([fullscreen]) .edit-side-rail,
  :host([fullscreen]) pf-edit-side-panel {
    top: 49px;
    bottom: 49px;
  }
  :host([fullscreen]) .edit-side-rail {
    right: 0;
    left: auto;
    width: 32px;
  }
  :host([fullscreen][edit-panel-open]) .edit-side-rail {
    right: 280px;
  }
  :host([fullscreen]) pf-edit-side-panel {
    right: 0;
    left: auto;
    width: 280px;
  }
  /* Reveal when rightReveal host attribute is set. */
  :host([fullscreen][right-reveal]) .edit-side-rail,
  :host([fullscreen][right-reveal]) pf-edit-side-panel {
    opacity: 1;
    pointer-events: auto;
    transform: translateX(0);
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
    align-items: center;
    gap: 6px;
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
  .footer-btn[aria-pressed="true"] {
    background: var(--pf-accent);
    color: var(--pf-on-accent);
    border-color: transparent;
  }
  .footer-btn pf-icon {
    font-size: 0.95rem;
  }

  /* iPad/touch refinements: retain the visual design while meeting Apple's
     44pt target size and respecting the home indicator/notch safe areas. */
  @media (pointer: coarse) {
    :host([fullscreen]) .toolbar {
      padding-top: max(var(--pf-space-2), env(safe-area-inset-top));
      padding-left: max(var(--pf-space-3), env(safe-area-inset-left));
      padding-right: max(var(--pf-space-3), env(safe-area-inset-right));
    }
    :host([fullscreen]) .bottombar {
      padding-bottom: max(var(--pf-space-2), env(safe-area-inset-bottom));
      padding-left: max(var(--pf-space-3), env(safe-area-inset-left));
      padding-right: max(var(--pf-space-3), env(safe-area-inset-right));
    }
    .nav {
      width: 48px;
      height: 48px;
    }
    .close-btn,
    .format-switch button,
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
    :host([fullscreen]:not([controls-hidden])) .edit-side-rail,
    :host([fullscreen]:not([controls-hidden])) pf-edit-side-panel {
      opacity: 1;
      pointer-events: auto;
      transform: translateX(0);
    }
    :host([fullscreen]) .edit-side-rail {
      width: 44px;
    }
  }
`;

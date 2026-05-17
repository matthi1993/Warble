/**
 * Styles for `<pf-full-view>`. Extracted from `full-view.ts` to keep
 * the orchestrator focused on logic. Includes toolbar / bottombar /
 * stage / fullscreen overlays / edit rail / footer-button styling.
 *
 * Card-specific styling (info / crop / basic / tone slider) lives
 * inside each sub-component.
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
  }
  :host([fullscreen]) {
    position: fixed;
    inset: 0;
    z-index: 1000;
    width: 100vw;
    height: 100vh;
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
    inset: 0;
    z-index: 2;
  }
  /* In fullscreen, push the overlay's stage inside the chrome bars
     so the star row + colour label aren't hidden behind the
     toolbar / bottombar. When the chrome fades on idle, the overlay
     fades with it (the rating is no longer relevant to the empty
     stage). */
  :host([fullscreen]) .fv-rating-overlay {
    top: 49px;
    bottom: 49px;
  }
  :host([fullscreen][idle]) .fv-rating-overlay {
    opacity: 0;
    pointer-events: none;
  }
  .fv-rating-overlay {
    transition: opacity 200ms ease;
  }
  :host([fullscreen]) .toolbar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 3;
    background: color-mix(in srgb, var(--pf-surface) 88%, transparent);
    backdrop-filter: blur(6px);
  }
  :host([fullscreen]) .bottombar {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 3;
    background: color-mix(in srgb, var(--pf-surface) 88%, transparent);
    backdrop-filter: blur(6px);
  }
  .nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 48px;
    height: 48px;
    border-radius: 999px;
    border: none;
    background: rgba(0, 0, 0, 0.45);
    color: #fff;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background var(--pf-transition);
    z-index: 2;
  }
  .nav:hover {
    background: rgba(0, 0, 0, 0.75);
  }
  .nav:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .nav.prev {
    left: var(--pf-space-3);
  }
  .nav.next {
    right: var(--pf-space-3);
  }
  .nav pf-icon {
    font-size: 1.5rem;
  }
  /* Native close button, never a custom element — guarantees clicks
     reach this handler even if shadow-DOM children get weird. */
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
  :host([fullscreen][idle]) .toolbar,
  :host([fullscreen][idle]) .bottombar,
  :host([fullscreen][idle]) .nav,
  :host([fullscreen][idle]) .hint {
    opacity: 0;
    pointer-events: none;
  }
  .toolbar,
  .bottombar,
  .nav,
  .hint {
    transition: opacity 200ms ease;
  }
  :host([fullscreen][idle]) {
    cursor: none;
  }
  /* Right-side editor panel: a floating overlay anchored to the
     right edge of the stage-row in both windowed and fullscreen
     modes. */
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
  /* In windowed mode the panel is in flex flow alongside the stage
     and is shown only when the user has explicitly expanded it. */
  :host(:not([fullscreen]):not([edit-panel-open])) pf-edit-side-panel {
    display: none;
  }
  /* In fullscreen, float over the stage and fade in/out via the
     edit-panel-visible host attribute. */
  :host([fullscreen]) .edit-side-rail,
  :host([fullscreen]) pf-edit-side-panel {
    position: absolute;
    top: 49px;
    bottom: 49px;
    flex: none;
    z-index: 5;
    background: color-mix(in srgb, var(--pf-surface) 92%, transparent);
    backdrop-filter: blur(6px);
    opacity: 0;
    transform: translateX(8px);
    pointer-events: none;
    transition: opacity 200ms ease, transform 200ms ease;
  }
  /* Rail anchors to the right edge when the panel is collapsed, and
     slides over to make room for the panel when one is open. */
  :host([fullscreen]) .edit-side-rail {
    right: 0;
    width: 32px;
    height: auto;
  }
  :host([fullscreen][edit-panel-open]) .edit-side-rail {
    right: 280px;
  }
  :host([fullscreen]) pf-edit-side-panel {
    right: 0;
    width: 280px;
  }
  :host([fullscreen][edit-panel-visible]) .edit-side-rail {
    opacity: 1;
    transform: translateX(0);
    pointer-events: auto;
  }
  /* Panel only fades in when a tab is actually selected. */
  :host([fullscreen][edit-panel-visible][edit-panel-open]) pf-edit-side-panel {
    opacity: 1;
    transform: translateX(0);
    pointer-events: auto;
  }
  /* Hover hot-zone on the right edge in fullscreen mode so the
     floating panel can be summoned without grazing the right edge
     precisely. */
  .edit-panel-hotzone {
    position: absolute;
    top: 0;
    bottom: 0;
    right: 0;
    width: 80px;
    z-index: 4;
    pointer-events: auto;
  }
  :host(:not([fullscreen])) .edit-panel-hotzone {
    display: none;
  }
  :host([fullscreen][idle]) .edit-panel-hotzone {
    pointer-events: none;
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
`;

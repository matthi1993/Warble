import { css } from "lit";

export const sidePanelStyles = css`
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
  .edit-tool-stack { display: grid; gap: var(--pf-space-2); }
  .edit-tool-stack.dim { opacity: 0.5; }
`;

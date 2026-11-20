import { css } from "lit";

export const slideshowSettingsStyles = css`
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
`;

import { css } from "lit";

export const photoGridStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    position: relative;
    height: 100%;
    min-height: 0;
    container-type: inline-size;
  }
  .grid-header {
    flex: 0 0 auto;
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: var(--pf-space-3);
    padding: var(--pf-space-3) 0 var(--pf-space-3);
    margin-bottom: var(--pf-space-2);
    background: var(--pf-bg);
    border-bottom: 1px solid var(--pf-border);
  }
  .grid-scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 0 2px var(--pf-space-4);
  }
  :host([full-view-open]) .grid-header {
    display: none;
  }
  .header-row {
    display: flex;
    align-items: center;
    gap: var(--pf-space-3);
    flex-wrap: wrap;
  }
  .folder-heading {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    flex: 1 1 180px;
  }
  .folder-heading .count {
    padding-left: 2px;
  }
  .size-controls {
    display: inline-flex;
    align-items: center;
    gap: var(--pf-space-2);
    margin-left: auto;
    min-width: 150px;
  }
  .subfolder-toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--pf-space-2);
    flex: 0 0 auto;
    color: var(--pf-text-muted);
    font-size: var(--pf-text-xs);
    cursor: pointer;
    user-select: none;
  }
  .subfolder-toggle input {
    margin: 0;
    accent-color: var(--pf-accent);
    cursor: pointer;
  }
  .folder-title {
    margin: 0;
    font-size: clamp(1.25rem, 2.6vw, 1.65rem);
    font-weight: 700;
    letter-spacing: -0.035em;
    color: var(--pf-text);
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .grid-header .label {
    font-size: var(--pf-text-xs);
    color: var(--pf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    flex: 0 0 auto;
  }
  .grid-header pf-slider {
    flex: 0 1 110px;
    min-width: 65px;
  }
  .grid-header .count {
    flex: 0 0 auto;
    font-size: var(--pf-text-xs);
    color: var(--pf-text-muted);
    font-variant-numeric: tabular-nums;
  }
  .empty-filter {
    padding: var(--pf-space-4);
    color: var(--pf-text-muted);
    font-size: var(--pf-text-sm);
    text-align: center;
  }
  .group-load-more {
    display: flex;
    justify-content: center;
    padding: var(--pf-space-2) 0 var(--pf-space-4);
  }
  .group-load-more button {
    padding: 4px 8px;
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-radius-sm);
    background: var(--pf-surface);
    color: var(--pf-text-muted);
    font: inherit;
    font-size: var(--pf-text-xs);
    cursor: pointer;
  }
  .group-load-more button:hover {
    border-color: var(--pf-accent);
    color: var(--pf-accent-hover);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(max(100px, calc((100% - (var(--pf-grid-cols, 6) - 1) * 10px) / var(--pf-grid-cols, 6))), 1fr));
    gap: 10px;
  }
  .day-group {
    margin-bottom: var(--pf-space-4);
  }
  .day-heading {
    display: flex;
    align-items: center;
    width: 100%;
    gap: var(--pf-space-2);
    margin: 0 0 var(--pf-space-2);
    padding: var(--pf-space-2) var(--pf-space-1);
    border: 0;
    background: transparent;
    color: var(--pf-text);
    text-align: left;
    cursor: pointer;
  }
  .day-heading:hover {
    color: var(--pf-accent);
  }
  .day-heading .day-title {
    font-size: var(--pf-text-sm);
    font-weight: 600;
  }
  .day-heading .day-count {
    color: var(--pf-text-muted);
    font-size: var(--pf-text-xs);
  }
  .day-heading .day-chevron {
    margin-left: auto;
    font-size: var(--pf-text-sm);
    transition: transform var(--pf-transition);
  }
  .day-heading[aria-expanded="false"] .day-chevron {
    transform: rotate(-90deg);
  }
  @container (max-width: 430px) {
    .size-controls { width: 100%; margin-left: 0; }
    .subfolder-toggle { order: 2; }
    .grid-header { max-height: 55vh; overflow-y: auto; }
    pf-photo-filter-panel { flex: 0 0 auto; }
  }
`;

import { css } from "lit";

export const postPresetsCardStyles = css`
  .body {
    padding: 8px 10px 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .empty {
    margin: 0;
    padding: 6px 8px;
    color: var(--pf-text-muted);
    font-size: var(--pf-text-xs);
  }
  .list {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .preset {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-radius-sm, 4px);
    overflow: hidden;
    background: var(--pf-surface);
  }
  .root-groups,
  .group-content:not([hidden]) {
    display: grid;
    gap: 4px;
    min-width: 0;
  }
  .root-groups:empty {
    display: none;
  }
  .preset-group {
    min-width: 0;
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-radius-sm, 4px);
  }
  .group-header {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    min-height: 25px;
  }
  .group-content {
    padding: 2px 4px 4px 8px;
  }
  .group-toggle,
  .group-action {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--pf-text);
    cursor: pointer;
    font-size: var(--pf-text-xs);
  }
  .group-toggle {
    padding: 2px 0;
    text-align: left;
  }
  .group-toggle span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .group-toggle pf-icon {
    flex: none;
  }
  .group-toggle[aria-expanded="false"] pf-icon {
    transform: rotate(-90deg);
  }
  .group-action {
    padding: 2px 5px;
    color: var(--pf-text-muted);
  }
  .group-action:hover,
  .group-toggle:hover {
    background: var(--pf-surface-hover);
  }
  .preset-group[data-dragging] {
    opacity: 0.45;
  }
  .preset-group[data-drop="before"] {
    box-shadow: 0 -2px var(--pf-accent, #4a90e2);
  }
  .preset-group[data-drop="after"] {
    box-shadow: 0 2px var(--pf-accent, #4a90e2);
  }
  .preset-group[data-drop="inside"],
  .ungrouped[data-group-drop] {
    outline: 1px solid var(--pf-accent, #4a90e2);
  }
  .list-label {
    margin-bottom: 4px;
    color: var(--pf-text-muted);
    font-size: var(--pf-text-xs);
  }
  .drag-handle {
    border: 0;
    background: transparent;
    color: var(--pf-text-muted);
    width: 26px;
    cursor: grab;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .drag-handle:active {
    cursor: grabbing;
  }
  .inline-name {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: stretch;
    min-width: 0;
  }
  .inline-name input {
    padding: 2px 4px;
  }
  .drag-source {
    position: absolute;
    width: 100%;
    opacity: 0;
    pointer-events: none;
  }
  .drag-preview {
    grid-template-columns: minmax(0, 1fr);
    border-style: dashed;
    border-color: var(--pf-accent, #4a90e2);
    background: var(--pf-surface-hover);
  }
  .preset:hover,
  .preset.active {
    border-color: var(--pf-accent, #4a90e2);
  }
  .select,
  .delete {
    border: 0;
    background: transparent;
    color: var(--pf-text);
    cursor: pointer;
    touch-action: manipulation;
  }
  .select {
    min-width: 0;
    padding: 6px 8px;
    text-align: left;
    font-size: var(--pf-text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .preset.active .select {
    color: var(--pf-accent, #4a90e2);
    font-weight: 600;
  }
  .delete {
    display: grid;
    place-items: center;
    width: 30px;
    border-left: 1px solid var(--pf-border);
    color: var(--pf-text-muted);
  }
  .delete:hover {
    color: var(--pf-text);
    background: var(--pf-surface-hover);
  }
  .delete pf-icon {
    font-size: 0.85rem;
  }
  .creation {
    display: grid;
    gap: 6px;
    border-top: 1px solid var(--pf-border);
    padding-top: 8px;
  }
  .save,
  .new-group {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 6px;
  }
  .save input {
    grid-column: 1 / -1;
  }
  .new-group {
    grid-template-columns: minmax(0, 1fr) auto auto;
  }
  .add-group {
    justify-self: start;
  }
  input,
  select {
    min-width: 0;
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-radius-sm, 4px);
    background: var(--pf-surface);
    color: var(--pf-text);
    padding: 6px 8px;
    font: inherit;
    font-size: var(--pf-text-xs);
    outline: none;
  }
  input:focus,
  select:focus {
    border-color: var(--pf-accent, #4a90e2);
  }
  button:not(.select, .delete, .drag-handle, .group-toggle, .group-action) {
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-radius-sm, 4px);
    background: var(--pf-surface);
    color: var(--pf-text);
    padding: 5px 9px;
    font-size: var(--pf-text-xs);
    cursor: pointer;
    touch-action: manipulation;
  }
  button:not(.select, .delete, .drag-handle, .group-toggle, .group-action):hover:not(:disabled) {
    background: var(--pf-surface-hover);
  }
  button:not(.select, .delete, .drag-handle, .group-toggle, .group-action):disabled {
    opacity: 0.4;
    cursor: default;
  }
`;

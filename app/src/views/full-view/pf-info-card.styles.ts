import { css } from "lit";

export const infoCardStyles = css`
  :host {
    display: block;
  }
  .exif-list {
    display: grid;
    grid-template-columns: 110px 1fr;
    column-gap: 10px;
    row-gap: 4px;
    margin: 0;
    padding: 0;
  }
  .exif-section {
    font-size: var(--pf-text-xs);
    font-weight: 600;
    color: var(--pf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 10px 0 4px;
  }
  .exif-section:first-child {
    margin-top: 0;
  }
  .exif-empty {
    font-size: var(--pf-text-xs);
    color: var(--pf-text-muted);
    padding: 4px 0;
  }
`;

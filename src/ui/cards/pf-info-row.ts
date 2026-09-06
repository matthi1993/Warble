/**
 * `pf-info-row` — a single key/value pair rendered as a `<dt>` /
 * `<dd>`. Value truncates with ellipsis and is also exposed as a
 * tooltip so the full text is reachable on hover.
 *
 * Intended for use inside a `<dl class="pf-info-list">` provided by
 * the parent card.
 */
import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("pf-info-row")
export class PfInfoRow extends LitElement {
  static styles = css`
    :host {
      display: contents;
    }
    dt {
      font-size: var(--pf-text-xs);
      color: var(--pf-text-muted);
      align-self: center;
      margin: 0;
    }
    dd {
      font-size: var(--pf-text-xs);
      color: var(--pf-text);
      margin: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
  `;

  @property({ type: String })
  label = "";

  @property({ type: String })
  value = "";

  render() {
    return html`
      <dt>${this.label}</dt>
      <dd title=${this.value}>${this.value}</dd>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-info-row": PfInfoRow;
  }
}

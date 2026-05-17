/**
 * `pf-post-process-card` \u2014 placeholder card for the post-process tab.
 * Will host export/share/conversion controls down the road; for now
 * just shows a TODO line so the tab is non-empty.
 */
import { LitElement, css, html } from "lit";
import { customElement } from "lit/decorators.js";
import "@ui/cards/pf-card";

@customElement("pf-post-process-card")
export class PfPostProcessCard extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    .todo {
      font-size: var(--pf-text-sm);
      color: var(--pf-text-muted);
      padding: var(--pf-space-2) 0;
    }
  `;

  render() {
    return html`
      <pf-card .title=${"Post Process"} ?open=${true}>
        <div class="todo">TODO</div>
      </pf-card>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-post-process-card": PfPostProcessCard;
  }
}

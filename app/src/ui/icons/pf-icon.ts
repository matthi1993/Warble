import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";
import { ICON_PATHS, type IconName } from "./icon-paths";

@customElement("pf-icon")
export class PfIcon extends LitElement {
  static styles = css`
    :host {
      display: inline-flex;
      width: 1em;
      height: 1em;
      line-height: 0;
      flex-shrink: 0;
    }
    svg {
      width: 100%;
      height: 100%;
      stroke: currentColor;
      fill: none;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `;

  @property({ type: String })
  name: IconName = "folder";

  render() {
    const path = ICON_PATHS[this.name] ?? "";
    return html`${unsafeSVG(`<svg viewBox="0 0 24 24">${path}</svg>`)}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-icon": PfIcon;
  }
}

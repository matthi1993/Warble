import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { app } from "@app/composition/app";
import "@ui/controls/pf-effect-toggle";
import { toolCards } from "../tool-cards";
import "./pf-post-presets-card";
import { postProcessCardStyles } from "./pf-post-process-card.styles";
import { PostPanelController } from "./post-panel-controller";

@customElement("pf-post-process-card")
export class PfPostProcessCard extends LitElement {
  static styles = postProcessCardStyles;

  private readonly controller = new PostPanelController(this, app.editing, app.tools);

  connectedCallback(): void {
    super.connectedCallback();
    this.controller.connect();
  }

  disconnectedCallback(): void {
    this.controller.disconnect();
    super.disconnectedCallback();
  }

  render() {
    const { enabled, tools, toolHost } = this.controller;
    return html`
      <div class="enable-row">
        <span class="label">Post-Processing ${enabled ? "enabled" : "disabled"}</span>
        <pf-effect-toggle
          .disabled=${!enabled}
          label="post-processing"
          @effect-toggle=${() => this.controller.toggleEnabled()}
        ></pf-effect-toggle>
      </div>
      <pf-post-presets-card></pf-post-presets-card>
      <div class=${enabled ? "stack" : "stack dim"}>${tools.map((tool) => toolCards.render(tool, toolHost))}</div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-post-process-card": PfPostProcessCard;
  }
}

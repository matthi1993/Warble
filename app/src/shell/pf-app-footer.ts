import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { app } from "@app/composition/app";
import "@app/views/settings";
import "@ui/controls/pf-view-mode-switch";
import { FooterTasksController } from "./footer-tasks-controller";
import { appFooterStyles } from "./pf-app-footer.styles";

@customElement("pf-app-footer")
export class PfAppFooter extends LitElement {
  static styles = appFooterStyles;

  @property({ type: String }) mode: "grid" | "image" = "grid";
  @property({ type: Boolean }) imageDisabled = false;
  private readonly tasks = new FooterTasksController(this, app.tasks);

  connectedCallback(): void {
    super.connectedCallback();
    this.tasks.connect();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.tasks.disconnect();
  }

  render() {
    const tasks = this.tasks;
    return html`
      ${tasks.working ? html`<span class="footer-task-spinner" aria-hidden="true"></span>` : null}
      <span class="footer-label">${tasks.status}</span>
      <span class="footer-task-details-wrap">
        <button type="button" class="footer-details" aria-expanded=${tasks.detailsOpen}
          @pointerdown=${(event: Event) => event.stopPropagation()}
          @click=${() => tasks.toggleDetails()}>Details</button>
        <pf-task-details .open=${tasks.detailsOpen} .tasks=${tasks.recentTasks}
          @task-details-close=${() => tasks.closeDetails()}></pf-task-details>
      </span>
      <span class="footer-spacer"></span>
      <pf-view-mode-switch .mode=${this.mode} .imageDisabled=${this.imageDisabled}></pf-view-mode-switch>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-app-footer": PfAppFooter;
  }
}

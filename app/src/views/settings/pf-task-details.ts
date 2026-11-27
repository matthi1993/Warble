import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { TaskRecord } from "@warble/core";
import { taskDetailsStyles } from "./pf-task-details.styles";
import { TaskDetailsModel } from "./task-details-model";

@customElement("pf-task-details")
export class PfTaskDetails extends LitElement {
  static styles = taskDetailsStyles;

  @property({ type: Boolean, reflect: true }) open = false;
  @property({ attribute: false }) tasks: readonly TaskRecord[] = [];
  private readonly model = new TaskDetailsModel();

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.open && event.key === "Escape") this.close();
  };

  private readonly onOutsidePointerDown = (event: PointerEvent): void => {
    if (this.open && !event.composedPath().includes(this)) this.close();
  };

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("pointerdown", this.onOutsidePointerDown);
  }

  disconnectedCallback(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("pointerdown", this.onOutsidePointerDown);
    super.disconnectedCallback();
  }

  private close(): void {
    this.dispatchEvent(new CustomEvent("task-details-close", { bubbles: true, composed: true }));
  }

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has("open") && this.open) this.renderRoot.querySelector<HTMLElement>(".popover")?.focus();
  }

  private renderTask(task: TaskRecord) {
    return html`
      <div class=${`task ${task.status}`}>
        <div class="label">${task.label}</div>
        <div class="target" title=${task.target ?? ""}>${this.model.targetLabel(task)}</div>
        <div class="meta">
          <span class=${`priority ${task.priority}`}>${task.priority}</span>
          <span class="status">${task.status}</span>
        </div>
      </div>
    `;
  }

  render() {
    if (!this.open) return nothing;
    return html`
      <section class="popover" tabindex="-1" role="dialog" aria-labelledby="task-details-title">
        <header>
          <h2 id="task-details-title">Recent tasks</h2>
          <span class="count">${this.model.activeCount(this.tasks)} active</span>
          <button class="close" type="button" aria-label="Close" @click=${this.close}>×</button>
        </header>
        ${this.tasks.length === 0
          ? html`<div class="empty">No recent tasks.</div>`
          : html`<div class="tasks">${this.tasks.map((task) => this.renderTask(task))}</div>`}
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-task-details": PfTaskDetails;
  }
}

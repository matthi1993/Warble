import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { TaskRecord } from "@services/tasks/task-manager";

@customElement("pf-task-details")
export class PfTaskDetails extends LitElement {
  static styles = css`
    :host {
      display: none;
    }
    :host([open]) {
      position: absolute;
      left: 0;
      bottom: calc(100% + 8px);
      z-index: 11000;
      display: block;
      width: min(430px, calc(100vw - 32px));
    }
    .popover {
      max-height: min(390px, calc(100vh - 72px));
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-lg);
      background: var(--pf-surface);
      color: var(--pf-text);
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.34);
    }
    header {
      display: flex;
      align-items: center;
      padding: var(--pf-space-3) var(--pf-space-4);
      border-bottom: 1px solid var(--pf-border);
    }
    h2 { flex: 1; margin: 0; font-size: var(--pf-text-base); font-weight: 600; }
    .count { color: var(--pf-text-muted); font-size: var(--pf-text-xs); }
    .tasks { overflow: auto; padding: var(--pf-space-1) var(--pf-space-4); }
    .task {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--pf-space-1) var(--pf-space-3);
      padding: var(--pf-space-3) 0;
      border-bottom: 1px solid var(--pf-border);
    }
    .task.completed, .task.cancelled { opacity: 0.68; }
    .task:last-child { border-bottom: 0; }
    .label { min-width: 0; font-size: var(--pf-text-sm); font-weight: 600; }
    .target {
      overflow: hidden;
      color: var(--pf-text-muted);
      font-size: var(--pf-text-xs);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .meta { display: flex; align-items: center; gap: var(--pf-space-2); grid-row: 1 / span 2; grid-column: 2; }
    .priority {
      padding: 2px 6px;
      border-radius: 999px;
      background: var(--pf-surface-2);
      color: var(--pf-text-muted);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .priority.urgent, .priority.high { color: var(--pf-accent); }
    .status { color: var(--pf-text-muted); font-size: var(--pf-text-xs); text-transform: capitalize; }
    .empty { padding: var(--pf-space-6) var(--pf-space-4); color: var(--pf-text-muted); text-align: center; }
    .close {
      width: 26px;
      height: 26px;
      margin-left: var(--pf-space-2);
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--pf-text-muted);
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
    }
    .close:hover { background: var(--pf-surface-2); color: var(--pf-text); }
    @media (max-width: 600px) {
      :host([open]) {
        position: fixed;
        right: 12px;
        bottom: calc(44px + env(safe-area-inset-bottom));
        left: 12px;
        width: auto;
      }
    }
  `;

  @property({ type: Boolean, reflect: true }) open = false;
  @property({ attribute: false }) tasks: readonly TaskRecord[] = [];

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

  private onKeyDown = (event: KeyboardEvent): void => {
    if (this.open && event.key === "Escape") this.close();
  };

  private onOutsidePointerDown = (event: PointerEvent): void => {
    if (this.open && !event.composedPath().includes(this)) this.close();
  };

  private close(): void {
    this.dispatchEvent(
      new CustomEvent("task-details-close", {
        bubbles: true,
        composed: true,
      })
    );
  }

  private displayTarget(task: TaskRecord): string {
    if (task.completed !== undefined && task.total !== undefined) {
      return `${task.completed} of ${task.total} photos`;
    }
    if (!task.target) return "";
    return task.target.split(/[\\/]/).filter(Boolean).pop() ?? task.target;
  }

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has("open") && this.open) {
      (this.renderRoot.querySelector(".popover") as HTMLElement | null)?.focus();
    }
  }

  render() {
    if (!this.open) return nothing;
    const activeCount = this.tasks.filter(
      (task) => task.status === "queued" || task.status === "running"
    ).length;
    return html`
      <section
        class="popover"
        tabindex="-1"
        role="dialog"
        aria-labelledby="task-details-title"
      >
        <header>
          <h2 id="task-details-title">Recent tasks</h2>
          <span class="count">${activeCount} active</span>
          <button class="close" type="button" aria-label="Close" @click=${this.close}>×</button>
        </header>
        ${this.tasks.length === 0
          ? html`<div class="empty">No recent tasks.</div>`
          : html`<div class="tasks">
              ${this.tasks.map((task) => html`
                <div class=${`task ${task.status}`}>
                  <div class="label">${task.label}</div>
                  <div class="target" title=${task.target ?? ""}>${this.displayTarget(task)}</div>
                  <div class="meta">
                    <span class=${`priority ${task.priority}`}>${task.priority}</span>
                    <span class="status">${task.status}</span>
                  </div>
                </div>
              `)}
            </div>`}
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pf-task-details": PfTaskDetails;
  }
}

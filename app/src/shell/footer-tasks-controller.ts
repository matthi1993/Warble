import type { TaskRecord, TaskTracker, Unsubscribe } from "@warble/core";
import type { UpdateHost } from "./shell-state";

export class FooterTasksController {
  recentTasks: readonly TaskRecord[] = [];
  detailsOpen = false;
  private activeTasks: readonly TaskRecord[] = [];
  private stopListening: Unsubscribe | null = null;

  constructor(
    private readonly host: UpdateHost,
    private readonly tasks: Pick<TaskTracker, "subscribe">,
  ) {}

  connect(): void {
    this.stopListening = this.tasks.subscribe((active, recent) => {
      this.activeTasks = active;
      this.recentTasks = recent;
      this.host.requestUpdate();
    });
  }

  disconnect(): void {
    this.stopListening?.();
    this.stopListening = null;
  }

  get working(): boolean {
    return this.activeTasks.length > 0;
  }

  get status(): string {
    const primary = this.activeTasks[0];
    if (!primary) return "Ready";
    const sameKindCount = this.activeTasks.filter((task) => task.kind === primary.kind).length;
    return `${primary.label}${sameKindCount > 1 ? ` (${sameKindCount})` : ""}…`;
  }

  toggleDetails(): void {
    this.detailsOpen = !this.detailsOpen;
    this.host.requestUpdate();
  }

  closeDetails(): void {
    this.detailsOpen = false;
    this.host.requestUpdate();
  }
}

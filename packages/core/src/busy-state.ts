import type { Unsubscribe } from "./emitter";
import type { TaskTracker } from "./task-tracker";

export type BusyListener = (label: string | null) => void;

export class BusyState {
  private readonly operations = new Map<symbol, string>();
  private readonly listeners = new Set<BusyListener>();

  constructor(private readonly tasks: TaskTracker) {}

  get label(): string | null {
    const labels = [...this.operations.values()];
    return labels.length > 0 ? labels[labels.length - 1] : null;
  }

  begin(label: string): () => void {
    const token = Symbol(label);
    const task = this.tasks.begin({ kind: "folder", label: label.replace(/…$/, ""), priority: "high" });
    this.operations.set(token, label);
    this.notify();
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      task.finish();
      this.operations.delete(token);
      this.notify();
    };
  }

  subscribe(listener: BusyListener): Unsubscribe {
    this.listeners.add(listener);
    listener(this.label);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const label = this.label;
    for (const listener of this.listeners) listener(label);
  }
}

import type { Unsubscribe } from "./emitter";

export type TaskPriority = "urgent" | "high" | "normal" | "background";
export type TaskStatus = "queued" | "running" | "completed" | "cancelled" | "failed";
export type FinishedTaskStatus = "completed" | "cancelled" | "failed";

export interface TaskRecord {
  id: number;
  kind: string;
  label: string;
  priority: TaskPriority;
  status: TaskStatus;
  target?: string;
  completed?: number;
  total?: number;
  startedAt: number;
  finishedAt?: number;
}

export interface BeginTaskOptions {
  kind: string;
  label: string;
  priority: TaskPriority;
  status?: "queued" | "running";
  target?: string;
  completed?: number;
  total?: number;
}

export interface TaskHandle {
  readonly id: number;
  update(update: Partial<Omit<TaskRecord, "id" | "startedAt">>): void;
  finish(status?: FinishedTaskStatus): void;
}

export type TaskListener = (active: readonly TaskRecord[], recent: readonly TaskRecord[]) => void;

const PRIORITY_ORDER: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, background: 3 };

export class TaskTracker {
  private readonly active = new Map<number, TaskRecord>();
  private readonly finished: TaskRecord[] = [];
  private readonly listeners = new Set<TaskListener>();
  private nextId = 1;
  private publishPending = false;

  constructor(private readonly recentLimit = 12) {}

  begin(options: BeginTaskOptions): TaskHandle {
    const id = this.nextId++;
    this.active.set(id, { id, ...options, status: options.status ?? "running", startedAt: Date.now() });
    this.schedulePublish();
    let finished = false;
    return {
      id,
      update: (update) => {
        const current = this.active.get(id);
        if (finished || !current) return;
        this.active.set(id, { ...current, ...update });
        this.schedulePublish();
      },
      finish: (status = "completed") => {
        if (finished) return;
        finished = true;
        this.finish(id, status);
      },
    };
  }

  subscribe(listener: TaskListener): Unsubscribe {
    this.listeners.add(listener);
    const active = this.activeSnapshot();
    listener(active, this.recentSnapshot(active));
    return () => this.listeners.delete(listener);
  }

  private finish(id: number, status: FinishedTaskStatus): void {
    const current = this.active.get(id);
    this.active.delete(id);
    if (current) {
      this.finished.unshift({ ...current, status, finishedAt: Date.now() });
      this.finished.length = Math.min(this.finished.length, this.recentLimit);
    }
    this.schedulePublish();
  }

  private schedulePublish(): void {
    if (this.publishPending) return;
    this.publishPending = true;
    queueMicrotask(() => this.publish());
  }

  private publish(): void {
    this.publishPending = false;
    const active = this.activeSnapshot();
    const recent = this.recentSnapshot(active);
    for (const listener of this.listeners) listener(active, recent);
  }

  private activeSnapshot(): TaskRecord[] {
    return [...this.active.values()].sort(
      (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.startedAt - b.startedAt,
    );
  }

  private recentSnapshot(active: readonly TaskRecord[]): TaskRecord[] {
    const newestActive = [...active].sort((a, b) => b.startedAt - a.startedAt);
    return [...newestActive, ...this.finished].slice(0, this.recentLimit);
  }
}

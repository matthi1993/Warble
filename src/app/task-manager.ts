/** Observable registry for work submitted to the backend image queue. */
import { invoke } from "@tauri-apps/api/core";

export type TaskKind =
  | "thumbnail"
  | "exif"
  | "hd-image"
  | "full-image"
  | "raw-image"
  | "folder";

export type TaskPriority = "urgent" | "high" | "normal" | "background";
export type TaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "cancelled"
  | "failed";
export type FinishedTaskStatus = "completed" | "cancelled" | "failed";

export interface TaskRecord {
  id: number;
  kind: TaskKind;
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
  kind: TaskKind;
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

type TaskListener = (
  activeTasks: readonly TaskRecord[],
  recentTasks: readonly TaskRecord[]
) => void;

let nextRequest = 1;
let nextTask = 1;
const activeTasks = new Map<number, TaskRecord>();
const finishedTasks: TaskRecord[] = [];
const listeners = new Set<TaskListener>();
const RECENT_TASK_LIMIT = 12;

function activeSnapshot(): TaskRecord[] {
  const priorityOrder: Record<TaskPriority, number> = {
    urgent: 0,
    high: 1,
    normal: 2,
    background: 3,
  };
  return [...activeTasks.values()].sort(
    (a, b) =>
      priorityOrder[a.priority] - priorityOrder[b.priority] ||
      a.startedAt - b.startedAt
  );
}

function recentSnapshot(active: readonly TaskRecord[]): TaskRecord[] {
  const newestActive = [...active].sort((a, b) => b.startedAt - a.startedAt);
  return [...newestActive, ...finishedTasks].slice(0, RECENT_TASK_LIMIT);
}

function notify(): void {
  const active = activeSnapshot();
  const recent = recentSnapshot(active);
  for (const listener of listeners) listener(active, recent);
}

/** Generate a process-unique backend request id. */
export function nextRequestId(): number {
  return nextRequest++;
}

/** Best-effort cancellation; callers still discard stale results locally. */
export function cancelTaskRequest(id: number): void {
  void invoke("cancel_image_request", { requestId: id }).catch(() => {});
}

/** Raise queued work when it becomes visible or opens in the full viewer. */
export function promoteTaskRequest(id: number, urgent: boolean): void {
  void invoke("promote_image_request", { requestId: id, urgent }).catch(() => {});
}

/** Register one unit of active work and return an idempotent lifecycle handle. */
export function beginTask(options: BeginTaskOptions): TaskHandle {
  const id = nextTask++;
  activeTasks.set(id, {
    id,
    ...options,
    status: options.status ?? "running",
    startedAt: Date.now(),
  });
  notify();

  let finished = false;
  return {
    id,
    update(update): void {
      if (finished) return;
      const current = activeTasks.get(id);
      if (!current) return;
      activeTasks.set(id, { ...current, ...update });
      notify();
    },
    finish(status: FinishedTaskStatus = "completed"): void {
      if (finished) return;
      finished = true;
      const current = activeTasks.get(id);
      activeTasks.delete(id);
      if (current) {
        finishedTasks.unshift({
          ...current,
          status,
          finishedAt: Date.now(),
        });
        if (finishedTasks.length > RECENT_TASK_LIMIT) {
          finishedTasks.length = RECENT_TASK_LIMIT;
        }
      }
      notify();
    },
  };
}

export function subscribeTasks(listener: TaskListener): () => void {
  listeners.add(listener);
  const active = activeSnapshot();
  listener(active, recentSnapshot(active));
  return () => listeners.delete(listener);
}

export function isTaskCancellation(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  const message = String((error as { message?: string } | null)?.message ?? error);
  return message.toLowerCase().includes("cancelled") ||
    message.toLowerCase().includes("aborted");
}

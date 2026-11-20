import type { TaskRecord } from "@warble/core";

export class TaskDetailsModel {
  activeCount(tasks: readonly TaskRecord[]): number {
    return tasks.filter((task) => task.status === "queued" || task.status === "running").length;
  }

  targetLabel(task: TaskRecord): string {
    if (task.completed !== undefined && task.total !== undefined) {
      return `${task.completed} of ${task.total} photos`;
    }
    if (!task.target) return "";
    return task.target.split(/[\\/]/).filter(Boolean).pop() ?? task.target;
  }
}

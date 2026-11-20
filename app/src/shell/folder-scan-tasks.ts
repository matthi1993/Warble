import type { TaskHandle, TaskTracker } from "@warble/core";
import type { FolderScanProgress } from "@warble/library";

export class FolderScanTasks {
  private readonly tasksByJob = new Map<number, TaskHandle>();

  constructor(private readonly tasks: Pick<TaskTracker, "begin">) {}

  report(progress: FolderScanProgress): void {
    const label = this.label(progress.kind);
    const target = progress.folderKey;
    let task = this.tasksByJob.get(progress.jobId);
    if (progress.phase === "queued") {
      task = this.tasks.begin({ kind: "folder", label, priority: "background", status: "queued", target });
      this.tasksByJob.set(progress.jobId, task);
      return;
    }
    if (progress.phase === "scanning" || progress.phase === "indexing") {
      if (!task) {
        task = this.tasks.begin({ kind: "folder", label, priority: "background", target });
        this.tasksByJob.set(progress.jobId, task);
      }
      task.update({ status: "running", label });
      return;
    }
    if (!task) return;
    task.finish(progress.phase === "done" ? "completed" : progress.phase === "error" ? "failed" : "cancelled");
    this.tasksByJob.delete(progress.jobId);
    if (progress.phase === "error") {
      console.error(`Failed to scan ${progress.folderKey}: ${progress.message ?? "unknown error"}`);
    }
  }

  cancelAll(): void {
    for (const task of this.tasksByJob.values()) task.finish("cancelled");
    this.tasksByJob.clear();
  }

  private label(kind: FolderScanProgress["kind"]): string {
    if (kind === "folderCheck") return "Check for folder changes";
    return kind === "folderTree" ? "Scan folder structure" : "Index folder images";
  }
}

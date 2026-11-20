import type { TaskPriority } from "@warble/core";
import type { ImageBackend } from "../ports/image-backend";

export class ImageRequests {
  private lastId = 0;

  constructor(private readonly backend: ImageBackend) {}

  nextRequestId(): number {
    return ++this.lastId;
  }

  cancelRequest(requestId: number): void {
    void this.backend.cancelRequest(requestId).catch(() => {});
  }

  setRequestPriority(requestId: number, priority: TaskPriority): void {
    void this.backend.setRequestPriority(requestId, priority).catch(() => {});
  }
}

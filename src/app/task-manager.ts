/** Request IDs and cancellation for in-flight image reads. */
import { invoke } from "@tauri-apps/api/core";

let nextId = 1;
/** Generate a process-unique request id. */
export function nextRequestId(): number {
  return nextId++;
}

/** Best-effort backend cancellation. Failures (e.g. backend already
 * finished) are intentionally swallowed — the caller will discard the
 * result via its own AbortController either way. */
export function cancelTaskRequest(id: number): void {
  void invoke("cancel_image_request", { requestId: id }).catch(() => {});
}

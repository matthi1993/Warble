/**
 * Front-end side of the backend's priority task pool.
 *
 * The Rust side (`src-tauri/src/tasks/`) splits image work into two
 * worker pools:
 *
 *   - **Foreground** (`urgent` + `foreground`): the photo currently
 *     on screen, the EXIF panel for it, and any thumbnail card the
 *     user is looking at.
 *   - **Background** (`background`): folder-wide thumbnail batches and
 *     full-image neighbour prefetches.
 *
 * Background work can never block foreground work because the two
 * pools have disjoint workers. Foreground work tagged `urgent` jumps
 * the foreground queue so a navigation away from the active photo
 * promptly re-tasks the workers.
 *
 * This module hands out monotonically-increasing request ids and
 * exposes a thin wrapper over the backend `cancel_image_request`
 * command so the canvas can drop in-flight decodes when the user
 * navigates.
 */
import { invoke } from "@tauri-apps/api/core";

export type TaskPriority = "urgent" | "foreground" | "background";

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

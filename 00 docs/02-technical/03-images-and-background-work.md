# Images and background work

Warble loads small images for browsing and larger ones only when needed.

## Image path

Image preparation and display are separate.

Native image code makes thumbnails and larger previews. The frontend displays decoded images and applies edits in the viewer. RAW photos use embedded previews when available instead of developing sensor data.

Start in [native imaging](../../src-tauri/src/imaging/) for image preparation and [the image canvas](../../src/features/image-viewer/pf-image-canvas.ts) for display. See [Image editing](04-image-editing.md) for visual tools.

## How work is ordered

Three coordinators keep browsing responsive; there is no single queue for all work. One folder scan runs at a time, while image workers can run alongside it.

- [Folder scans](../../src-tauri/src/library/scanner.rs) use their own worker. Tree discovery and photo discovery are queued there; a required tree scan runs before its photo scan. Newer requests can replace stale work.
- [Image requests](../../src-tauri/src/tasks/mod.rs) use a small worker pool. Queued requests are picked by priority: **urgent** for the open photo, **normal** for visible thumbnails, then **background** for filter metadata and thumbnail warmup. A queued request can move up when its photo becomes visible.
- [Selected-folder processing](../../src/services/library/photo-processing-pipeline.ts) requests filter metadata in small batches, then warms a limited set of thumbnails. Visible cards can request thumbnails independently instead of waiting for warmup.

Priority changes which *waiting* request runs next; it does not interrupt work already running. Switching folders or photos cancels work that is no longer useful, and late results are ignored. See [Background work](../01-features/04-background-work.md) for the visible behavior.

## Caches and progress

Caches avoid repeating work, while the task list reports its progress.

Memory and disk caches reuse previews; changed sources invalidate affected results, which are rebuilt on demand. [The task manager](../../src/services/tasks/task-manager.ts) tracks active and recent work for the footer and details view; it shows status but does not schedule the native queues.
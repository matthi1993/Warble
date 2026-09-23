# Image loading and background work

Warble prepares several image sizes so the interface can respond quickly while
still showing a high-quality photo when needed.

## Image loading

The grid uses small thumbnails. The detail panel and full view can first show a
thumbnail, then replace it with a larger preview. For RAW files, Warble shows
only a camera-embedded preview when available; it does not develop sensor data.

Decoded images and generated previews are reused where possible. Cache limits
and preview quality can be changed from Performance & Caches.

Image display is handled by
[`pf-image-canvas.ts`](../src/ui/photos/pf-image-canvas.ts). Native image work
lives under [`src-tauri/src/imaging/`](../src-tauri/src/imaging/).

## Folder preparation

Import first publishes the folder tree, without decoding photos or reading
EXIF. Opening a folder queues image discovery; the current catalog photo list
stays readable while the filesystem scan runs. Once discovered, the selected
folder's processing pipeline reads filter metadata in small, cancellable
background batches and then warms up to 64 thumbnails. Results appear as
they become ready; browsing does not wait for the entire pipeline.

Visible cards request thumbnails on demand at a higher priority than metadata
or warmup. HD and full-size previews are only requested when viewing a photo;
they are never produced for every image during import or sync. Other folders
are processed when opened rather than doing library-wide decoding up front.

Changing folders cancels work that is no longer useful. Existing thumbnails
and metadata are reused when they are already available.

## Synchronizing external changes

Sync checks the chosen folder or all imported roots, recursively discovers
photos, and reads adjacent XMP and Warble sidecars. A changed source photo
invalidates its cached metadata and previews, which are rebuilt when requested.
Sync does not eagerly decode the whole library. It must be started manually;
there is no filesystem watcher. See
[Photo processing and folder sync](processing-pipeline-and-sync.md) for
fingerprints, sidecar precedence, error handling, and the exact stage order.

## Priorities

Opening the current photo has the highest priority. Visible thumbnails come
next. Filter metadata and bounded thumbnail warmup run in the background,
with cancellation when the selection changes. Folder structure and image
discovery use a separate scan coordinator, so they cannot occupy the image
workers.

Frontend task coordination is in
[`task-manager.ts`](../src/app/task-manager.ts). The native worker queue is in
[`tasks/mod.rs`](../src-tauri/src/tasks/mod.rs). The selected-folder stages
are coordinated by
[`photo-processing-pipeline.ts`](../src/app/photo-processing-pipeline.ts);
the folder tree and file discovery queue is in
[`scanner.rs`](../src-tauri/src/library/scanner.rs).

## Status and details

The app footer shows the most important active task, such as generating a
thumbnail, reading photo metadata, or opening an image. The Details button
opens a small list of active and recent tasks with their target, state, and
priority. When no work is active, the footer shows Ready.

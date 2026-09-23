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

After a folder opens, Warble prepares thumbnails and reads the metadata needed
for date groups and filters. Results appear as they become ready; browsing does
not need to wait for the whole folder.

Changing folders cancels work that is no longer useful. Existing thumbnails
and metadata are reused when they are already available.

## Priorities

Opening the current photo has the highest priority. Visible thumbnails and
metadata needed by the grid come next. Work that prepares the rest of the
folder runs in the background.

Frontend task coordination is in
[`task-manager.ts`](../src/app/task-manager.ts). The native worker queue is in
[`tasks/mod.rs`](../src-tauri/src/tasks/mod.rs).

## Status and details

The app footer shows the most important active task, such as generating a
thumbnail, reading photo metadata, or opening an image. The Details button
opens a small list of active and recent tasks with their target, state, and
priority. When no work is active, the footer shows Ready.

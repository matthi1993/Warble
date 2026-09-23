# Photo processing and folder sync

This page describes the **current implementation** of folder discovery, photo
indexing, metadata reconciliation, image loading, and writeback. For the
user-facing behavior, see [Library and browsing](library-and-browsing.md) and
[Image loading and background work](image-loading-and-background-work.md).
Original photo files are read during indexing and rendering, not rewritten by
metadata sync. Explicit export/save-variant and delete-photo actions are
separate operations.

## At a glance

| Stage | Trigger | Owner | When the UI can proceed |
| --- | --- | --- | --- |
| Register root | Add or reconnect | [Library commands](../src-tauri/src/commands/library.rs), SQLite, device grants | As soon as the root is persisted; a placeholder appears immediately |
| Discover folder tree | Add, reconnect, startup, or Sync | [Scan coordinator](../src-tauri/src/library/scanner.rs) | Does not decode images or read EXIF |
| Discover photo files | Open a folder or Sync | Scan coordinator and [catalog](../src-tauri/src/library/catalog.rs) | Indexed photos appear before sidecar reconciliation finishes |
| Reconcile sidecars | After photo discovery | [Portable index sync](../src-tauri/src/library/loader.rs) and [sidecar adapter](../src-tauri/src/sidecar.rs) | Runs on a separate blocking task, in SQLite batches of 64 |
| Load grid metadata | Select photos in a folder | [Frontend processing pipeline](../src/services/library/photo-processing-pipeline.ts), [EXIF cache](../src-tauri/src/imaging/exif_cache.rs) | Four photos per cancellable batch; the grid is already usable |
| Render thumbnails and previews | Visible card or opened photo; optional warmup | [Image worker pool](../src-tauri/src/tasks/mod.rs) | On demand, not required to complete a folder scan |

The folder scan queue and image worker pool are separate. A tree scan does not
occupy the workers used by an opened photo. The frontend records scan and
image work in the [task manager](../src/services/tasks/task-manager.ts) for the footer.

## Add, open, and Sync

1. **Add/reconnect:** The selected path is validated and bound to a portable
   media-root UUID. [Library loader](../src-tauri/src/library/loader.rs) adds a
   pending root and queues a tree scan. Startup restores root placeholders and
   also queues tree scans; it does not recursively decode the library.
2. **Open folder:** [App shell](../src/app/app-shell.ts) requests the current
   catalog photo list immediately and queues `index_folder_images` if the
   chosen folder/subtree is not indexed. When discovery completes,
   `folder-images-updated` refreshes the visible list. Including subfolders
   makes the discovery recursive.
3. **Sync one folder / all roots:** App shell flushes pending in-app edits,
   effects, and ratings before queuing work. `refresh_folder` or
   `refresh_imported_folders` schedules the folder tree first, then a **forced
   recursive** image scan, including photos in unopened subfolders. Sync
   re-reads sidecars; it does not generate every thumbnail or HD preview.
   Missing-photo rows are pruned only for the explicitly synced scope.
4. **Reconcile:** After `folder-images-updated`, a separate blocking task
   imports XMP and Warble sidecars and fingerprints. If indexed state changed,
   `photo-index-synced` tells the frontend to reload metadata stores and
   invalidate affected image caches. This event comes *after* the import,
  whereas `folder-images-updated` only means discovery is done. The folder
  scan task can finish before sidecar import finishes.

The [scan coordinator](../src-tauri/src/library/scanner.rs) queues `FolderTree`
and `FolderImages` jobs with per-root/per-job generations. Superseded results
are discarded; its queue is separate from the cancellable image requests. A
folder can remain browsable with its previous catalog entries while a rescan
runs. Explicit Sync is manual; there is no filesystem watcher that instantly
detects changes made by another application.

## Where state lives

| Data | Primary location | Import and invalidation |
| --- | --- | --- |
| Imported roots, selection, per-photo indexes, settings | Device-local SQLite library in the app-data directory | The catalog hydrates from it; folder/photo Sync reconciles the photo rows |
| Physical root bindings and device cache preferences | Device-local device-state file | Roots may need reconnecting on another device |
| Star rating and colour label | Adjacent `.xmp` sidecar, indexed in `photo_ratings` | XMP is read on photo discovery; in-app changes write XMP first, then SQLite |
| Edits, effects, cached EXIF | Adjacent `<image extension>.warble.json` sidecar; edits/EXIF and effects also indexed in SQLite | Read during photo reconciliation; EXIF is only trusted when its source fingerprint matches |
| Image/XMP/Warble file fingerprints | SQLite `photo_source_state` | Compared during photo reconciliation, then updated in the same transaction |
| Generated thumbnails and HD previews | App cache directory; renderer caches | Regenerated on demand when invalidated, not portable source data |

Portable photo keys are `<root UUID>/<relative photo path>`. XMP uses the
source extension replaced by `.xmp` (for example, `IMG.CR3` → `IMG.xmp`),
whereas Warble appends `.warble.json` to the full image filename (for example,
`IMG.CR3.warble.json`). This matters for a RAW/JPEG pair: its two source files
can share an XMP path. The [repository](../src-tauri/src/library/repository.rs)
owns schema migration and SQLite transactions; the
[sidecar adapter](../src-tauri/src/sidecar.rs) owns sidecar reads and atomic
writes.

### Detecting external edits

On a photo index pass, `photo_source_state` compares the image's modification
time and size and, independently, the XMP and Warble sidecars' times and sizes.
Times use nanosecond precision where the filesystem provides it. If the image
changed, the local EXIF row is discarded; EXIF is parsed again when needed.
A valid adjacent Warble EXIF cache can seed the index. Warble edits and effects
remain portable across an image replacement, while stale cached EXIF does not.
XMP rating changes are imported; removal of previously indexed XMP rating
data clears the local rating. Removing an indexed Warble sidecar clears its
indexed edits/EXIF. An unreadable sidecar is logged and skipped rather than
overwritten; not every import error is surfaced as an in-app alert.
Sync prunes metadata rows for photos no longer present in its scanned scope.

Fingerprints are **not content hashes**. A same-size file replaced without a
detectable timestamp change can evade invalidation. File-provider timestamp
precision and simultaneous edits in multiple apps can affect conflict
resolution; the sidecar importer treats readable portable sidecars as the
source for ratings and adjustments on rescan.

### In-app writeback

- Rating changes are serialized per photo in the
  [rating store](../src/services/rating/rating-store.ts). The backend writes
  the adjacent XMP packet before updating SQLite. A manual Sync waits for
  pending rating writes; a failed write blocks that Sync rather than silently
  importing old data.
- Photo edits and effects are written to the Warble sidecar and indexed in
  SQLite through [edit commands](../src-tauri/src/commands/edits.rs) and
  [preferences commands](../src-tauri/src/commands/preferences.rs). The app
  flushes pending edits/effects before Sync.
- Setting an image's rating or adjustment does **not** modify its original
  pixels. Filesystems must allow sidecar writes for portable changes to
  persist; a failed sidecar write needs attention rather than being treated
  as a successful sync.

## Display and cache lifecycle

The selected-folder [frontend pipeline](../src/services/library/photo-processing-pipeline.ts)
enriches photos with filter/date metadata in batches of **4**, then warms up
to **64** thumbnails sequentially. Switching folders cancels its current
request/warmup and discards late results. Visible cards request thumbnails
independently at higher priority. Opening a photo requests an HD rendition
and optionally full resolution; neither is generated for all photos during
Sync. Desktop has two image workers; iOS has one. Active-photo work is urgent,
visible thumbnails normal, and bulk filter metadata/warmup background.

The [thumbnail](../src-tauri/src/imaging/thumbnails/mod.rs) and
[HD](../src-tauri/src/imaging/hd_image/mod.rs) disk keys include image path,
size, and modification time, so changed files miss the old cache entry. There
is no need to regenerate or purge *all* disk cache files on each Sync. When
`photo-index-synced` reports changed image keys, app shell invalidates the
path-scoped [thumbnail](../src/services/images/thumbnail-service.ts),
[HD](../src/services/images/hd-image-cache.ts), and
[full-image](../src/services/images/full-image-cache.ts) renderer caches, refreshes
visible cards, and reloads an open photo. Settings also allow clearing
generated caches separately.

## Reset workspace and boundaries

**Reset workspace** in [Settings](../src/app/pf-settings.ts) asks for
confirmation, clears SQLite library content and root bindings, then reloads
the app with an empty folder list. It does **not** delete originals or their
XMP/Warble sidecars. Adding the same folders later can reimport portable
ratings and edits. Disk caches and device-only cache preferences are distinct
from the SQLite library. The implementation is in
[library loader](../src-tauri/src/library/loader.rs) and
[repository](../src-tauri/src/library/repository.rs).

For changes to the processing architecture, keep these boundaries: catalog
discovery should be cheap, portable sidecar reconciliation should not block
the first photo list, and expensive previews should remain cancellable and
on demand. Add any new persistent photo field to both its portable writeback
path and the rescan/index invalidation path.
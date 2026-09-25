# Library and sync

Warble discovers files in the background and keeps portable photo changes beside the originals.

## Discovery

Adding or reconnecting a root scans its folder tree, then indexes its photos and videos recursively in the background. Opening a folder can still request its media before the initial scan finishes; manual Sync checks the chosen area, including nested folders, for external changes. The media list can appear before metadata is ready.

Start in [the scan coordinator](../../src-tauri/src/library/scanner.rs) for discovery and [the app shell](../../src/app/app-shell.ts) for selection and Sync.

## Storage and reconciliation

SQLite holds the local library index and speeds up browsing. XMP sidecars carry ratings and labels; Warble sidecars carry edits and effects. When a folder is scanned, portable sidecar data is read back into the index. Device-specific folder access and generated previews are separate from this portable photo state. Original image pixels are not rewritten by Sync.

Start in [the library repository](../../src-tauri/src/library/repository.rs) for the index and [the sidecar adapter](../../src-tauri/src/sidecar.rs) for portable files.

## Changes and caches

A changed image may need fresh metadata and previews. Warble invalidates affected cached data and regenerates previews when they are requested, rather than rebuilding the whole library on every Sync. Pending in-app changes are saved before a manual Sync.

Start in [the library loader](../../src-tauri/src/library/loader.rs) for reconciliation and [the photo processing pipeline](../../src/services/library/photo-processing-pipeline.ts) for selected-folder metadata. See [Images and background work](03-images-and-background-work.md) for preview loading.
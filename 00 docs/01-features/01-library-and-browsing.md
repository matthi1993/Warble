# Library and browsing

Warble browses photos in their existing folders without copying originals into a new library.

## Folders and Sync

Add a folder to see its tree, then select a folder to see its photos. You can include subfolders. If files change outside Warble, use Sync to check for changes; it does not watch folders automatically. Unavailable folders can be reconnected.

Start in [the app shell](../../src/app/app-shell.ts) for folder selection and Sync, or [the library scanner](../../src-tauri/src/library/scanner.rs) for discovery.

## Grid and photo choices

The grid groups photos by date and lets you filter by rating, colour label, camera, lens, focal length, or date. You can rate a photo with stars, give it a colour label, and choose between available files and variants. Some RAW files use an embedded preview rather than a developed image.

Start in [the photo grid](../../src/app/photo-grid.ts) for browsing and [photo types and variants](../../src/domain/photo/) for grouping files.

## Keeping photo state

Original pixels are not changed by ratings or edits. Ratings and labels can be stored beside the photo in XMP files; edits use Warble sidecars. The local library helps Warble browse quickly. Reset workspace clears the local library, not the originals or their sidecars; adding the folders again can restore portable photo state.

See [Library and sync](../02-technical/02-library-and-sync.md) for the storage boundaries.
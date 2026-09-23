# Library and browsing

Warble treats imported folders as the photo library. Originals stay in their
existing location, and the folder tree mirrors their directory structure.

## Folder management

Folders can be added as library roots and browsed without moving the photos.
A selected folder can include only its direct photos or all photos from nested
folders. Adding a root discovers its folder tree; opening a folder indexes its
photos as needed. **Sync** manually checks folders and photos, including
unopened subfolders, for changes made outside Warble. There is no automatic
filesystem watching. On another device, a root can be reconnected after
access is granted again.

Folder discovery and the library catalog live under
[`src-tauri/src/library/`](../src-tauri/src/library/).

## Photos, formats, and variants

Warble recognises common JPEG, PNG, TIFF, and camera RAW formats. Files with a
shared name can appear as one photo with multiple files or JPEG variants.
RAW files can be opened in the system's default app from the full view but
cannot be selected as editable variants. RAW-only photos show their embedded
JPEG preview when one exists.

Edited photos can be saved as new JPEG variants. A photo or variant can also
be moved to the system Bin from the full view.

Photo and variant rules are defined under
[`src/domain/photo/`](../src/domain/photo/).

## Grouping and filters

Photos are grouped by their capture day when date metadata is available.
Photos without a usable capture date remain in a separate group.

The grid can filter by:

- minimum star rating;
- one or more colour labels;
- camera or lens name;
- minimum and maximum focal length;
- capture date range.

Camera and lens fields also accept partial text. Filters and date groups update
as photo metadata becomes available.

## Ratings and labels

Each photo can have a zero-to-five star rating and a colour label. Ratings and
labels are visible in both the grid and full view and can be changed with the
mouse or number shortcuts.

Rating behavior lives under
[`src/services/rating/`](../src/services/rating/).

## Photo state

Normal browsing and editing do not overwrite original image pixels. Ratings
and labels are written to adjacent XMP files; edits and effects to adjacent
Warble sidecars. SQLite indexes this portable state locally to make browsing
fast. Sync reimports readable sidecar changes and refreshes changed images
without eagerly rebuilding every preview. A read-only photo folder can
prevent sidecar changes from being saved.

Reset workspace clears the local library and root bindings, **not** the photo
files or their sidecars. To restore portable ratings and edits after a reset,
add the folders again. See [Photo processing and folder sync](processing-pipeline-and-sync.md)
for the ordered stages, storage rules, and known limits.

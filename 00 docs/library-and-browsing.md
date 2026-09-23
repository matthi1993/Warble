# Library and browsing

Warble treats imported folders as the photo library. Originals stay in their
existing location, and the folder tree mirrors their directory structure.

## Folder management

Folders can be added as library roots and browsed without changing their
contents. A selected folder can include only its direct photos or all photos
from nested folders. Refresh finds files that were added or removed outside
Warble. On another device, a library root can be reconnected after access is
granted again.

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
and Warble-specific adjustments can be stored beside photos in sidecar files.
A device-local catalog remembers the library and makes repeated access fast.

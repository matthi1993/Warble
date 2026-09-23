# App overview

Warble is a photo viewer and non-destructive editor for Mac and iPad. It works
directly with photo folders instead of requiring photos to be copied into the
app.

The usual workflow is:

1. Add or reconnect a photo folder.
2. Browse thumbnails in the grid.
3. Group or filter photos using ratings and camera metadata.
4. Open a photo for a larger view, information, variants, and editing.
5. Save an edited result as a new JPEG variant when needed.

## Main areas

The app is built around a few connected views:

- The folder sidebar selects the part of the library to browse.
- The photo grid shows, groups, and filters the current folder.
- The detail panel gives a larger preview of the selected photo.
- The full view provides focused viewing, photo information, and editing.
- The footer reports thumbnail, metadata, and image-loading work.

See [Views and navigation](views-and-navigation.md) for the controls available
in each view.

## Features

Warble supports folder libraries, common photo and RAW formats, date grouping,
metadata filters, star ratings, colour labels, sidecar pairs, photo variants,
fullscreen viewing, EXIF information, and non-destructive editing. Generated
thumbnails and previews are cached locally to keep browsing fast.

These topics are described in:

- [Library and browsing](library-and-browsing.md)
- [Image loading and background work](image-loading-and-background-work.md)
- [Editor tools](editor-tools.md)

Browse the [documentation home](README.md) for all guides. For the exact
processing stages and portable metadata rules, see
[Photo processing and folder sync](processing-pipeline-and-sync.md).

## Code entry points

The main application layout and navigation live in
[`app-shell.ts`](../src/app/app-shell.ts). User-facing views are under
[`src/app/`](../src/app/), shared controls are under [`src/ui/`](../src/ui/),
and native photo and file work is under
[`src-tauri/src/`](../src-tauri/src/).

See [`architecture.md`](../architecture.md) for the project layers and where
new code belongs.

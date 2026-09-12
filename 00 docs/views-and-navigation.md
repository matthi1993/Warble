# Views and navigation

Warble keeps the library visible while making it quick to move from browsing
to focused photo work.

## App shell

The normal window has a folder sidebar, photo grid, detail panel, and footer.
The sidebar can be hidden when more space is needed, while the full view takes
over the photo area for focused viewing. When no folder is selected, the main
area shows the welcome view.

[`app-shell.ts`](../src/app/app-shell.ts) coordinates the layout, selection,
and movement between views.

## Folder sidebar

The sidebar lists imported folders as a tree. It supports adding folders,
refreshing their contents, reconnecting unavailable roots, and removing a root
from the library. Selecting a folder replaces the photos shown in the grid.

## Photo grid

The grid is the main browsing view. It provides thumbnail sizing, optional
subfolder inclusion, date groups, filters, ratings, and colour labels. Large
groups load in smaller pages so the view remains manageable.

Photos can be selected with a click or the arrow keys. Enter or a double-click
opens the selected photo. The grid is defined in
[`photo-grid.ts`](../src/app/photo-grid.ts).

## Detail panel

The detail panel shows a larger preview of the selected grid photo together
with its name and path. It also provides format and variant choices when a
photo has more than one source file. The photo can be opened in the full view
or expanded to fullscreen.

The panel is defined in [`detail-panel.ts`](../src/app/detail-panel.ts).

## Full view

The full view gives the photo most of the window. Previous and next controls
move through the current grid order. The top toolbar provides format and
variant selection, Open In, delete, fullscreen, and close actions.

The side panel has three areas:

- Info shows EXIF and file information.
- Edit contains adjustments for the current photo.
- Post contains global finishing controls and presets.

The bottom controls change the viewing background, fit, scale, and smoothing.
Edits can be compared with the original, reset, or saved as a new JPEG
variant.

The view is coordinated by [`full-view.ts`](../src/app/full-view.ts), with its
main controls in [`chrome.ts`](../src/app/views/full-view/chrome.ts).

## Fullscreen and keyboard use

Fullscreen hides the normal app panels and keeps the photo controls available
as overlays. Common actions such as navigation, opening and closing views,
ratings, labels, and editing tools have keyboard shortcuts. Shortcut hints are
shown in the full view where they are relevant.

# Background work

Warble prepares a photo when you need it rather than loading the whole library at once.

## What appears first

The folder tree appears before its photos are fully processed. When you open a folder, the grid can show photos while metadata and thumbnails are still arriving. Opening a photo asks for a larger preview; you do not have to wait for the rest of the folder.

Start in [the app shell](../../src/app/app-shell.ts) for folder loading and [the image canvas](../../src/features/image-viewer/pf-image-canvas.ts) for the open photo.

## What gets attention

The photo you are viewing comes before visible grid thumbnails. Filter metadata and preparation of thumbnails you have not viewed yet run in the background. If you change folders or move to another photo, work for the old selection can be cancelled. A previously prepared image can be reused.

The footer shows the most important active work; Details shows active and recent tasks. See [Images and background work](../02-technical/03-images-and-background-work.md) for how work is queued and run.
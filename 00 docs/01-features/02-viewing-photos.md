# Viewing photos

Move from the grid to a larger preview or a focused full view.

## Detail and full view

Select a photo to see it in the detail panel. Open it in full view for photo information, format and variant choices, editing controls, and fullscreen viewing. Arrow keys and swipes move through the current grid order.

Video clips play in the detail panel and full view with native playback controls. Press Space to play or pause an active video; press P to start or stop a presentation from the grid or full view. Full view applies the same background, frame and proofing margin to clips but does not apply photo edits or Post effects. A Live Photo initially shows its still image; use Play Live Photo to switch to its paired video and Show photo to return. In a slideshow, videos (including Live Photo motion clips) play to the end before the next item; still photos use the configured duration. Video playback depends on codecs supported by the device's WebView. Video capture dates come from the QuickTime creation date when available (preserving its recorded local time), or the movie header's UTC creation time.

Start in [the detail panel](../../src/app/detail-panel.ts) or [the full view](../../src/app/full-view.ts).

## Previews and status

The grid loads thumbnails; larger previews arrive when a photo is opened. RAW viewing uses an embedded preview when available. The footer shows active image and library work, while Performance & Caches controls preview and cache settings.

Start in [the image canvas](../../src/features/image-viewer/pf-image-canvas.ts) for display. See [Background work](04-background-work.md) for what loads first and [Images and background work](../02-technical/03-images-and-background-work.md) for implementation.
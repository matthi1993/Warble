# Editing photos

Warble applies non-destructive changes while keeping the original photo intact.

## Edit and Post

Use Edit for one photo and Post for the overall look.

Edit controls affect the current photo; Post controls affect the viewing result across photos. You can compare an edited photo with its original, reset changes, and save a new JPEG variant. RAW sensor data is not edited directly; choose an editable image variant instead. Edits are shown as you adjust controls without changing the original pixels.

Start in [the full view](../../src/app/full-view.ts) for the editing experience and [the editor registry](../../src/features/editor/registry.ts) for available tools.

## Tools

Tools appear in the Edit or Post panel depending on what they change. Crop changes the photo frame; colour and tone tools change its appearance. The [editor registry](../../src/features/editor/registry.ts) is the starting point for the tool list.

For rendering and adding tools, see [Image editing](../02-technical/04-image-editing.md). For stored photo changes, see [Library and sync](../02-technical/02-library-and-sync.md).
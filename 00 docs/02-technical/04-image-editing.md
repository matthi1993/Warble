# Image editing

Editing changes how a decoded image is displayed; the original file remains unchanged.

## Rendering

The native backend provides image bytes or an embedded RAW preview. The [image canvas](../../src/features/image-viewer/pf-image-canvas.ts) displays the decoded image. For pixel changes, [the editor renderer](../../src/features/editor/rendering/render-pipeline.ts) combines registered tool shaders into one WebGL program: photo adjustments run before global Post adjustments. Changing a control updates shader values for the next draw, not the source file. Crop changes the visible frame instead of adding a pixel shader.

Photo settings are read through [the editor state contract](../../src/features/editor/editor-state.ts) and [its store adapter](../../src/features/editor/adapters/store-state.ts). Per-photo edits and effects are kept in the local library and adjacent Warble sidecars; current Post settings are global and stored locally. See [Library and sync](02-library-and-sync.md) for portable data.

## Adding a tool

Follow one existing tool in [the editor tools folder](../../src/features/editor/tools/) before adding another.

1. Define its values and defaults in [the edit domain](../../src/domain/edits/). Decide whether they belong to a photo, Post, or both, and how they should be saved.
2. Add a tool controller and panel UI under [the editor tools folder](../../src/features/editor/tools/). Use [the tool contract](../../src/features/editor/tool.ts) for lifecycle, reset, and copy/paste behavior where relevant.
3. If it changes pixels, add a shader module in the same tool folder. The [render pipeline](../../src/features/editor/rendering/render-pipeline.ts) combines registered shaders; support neutral values so disabling a tool leaves the image unchanged. Geometry-only tools may not need a shader.
4. Expose new reads and writes through [the editor state contract](../../src/features/editor/editor-state.ts) and [store adapter](../../src/features/editor/adapters/store-state.ts). If the value is per-photo, cover its save, reload, reset, and Sync behavior.
5. Register its scope, order, controller, value reader, and optional shader in [the editor registry](../../src/features/editor/registry.ts). Check Edit and Post, toggling, navigation, and saving a variant as applicable.
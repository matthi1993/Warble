# Image editing

Editing changes how a decoded image is displayed; the original file remains unchanged.

## Rendering

The native backend provides image bytes or an embedded RAW preview. The [image canvas](../../src/features/image-viewer/pf-image-canvas.ts) displays the decoded image. For pixel changes, [the editor renderer](../../src/features/editor/rendering/render-pipeline.ts) combines the main tool shaders into one WebGL program: bloom runs on the source first, followed by photo adjustments and then the remaining global Post adjustments. This lets both Color tools apply saturation and black-and-white settings to the glow as well as the image. Changing a control updates shader values for the next draw, not the source file. The renderer retains the active photo’s HD and full-resolution GPU textures so slider movements do not repeatedly upload the same pixels or rebuild mipmaps. Slider adjustments keep the full-resolution source when available. During actual slider changes, zooming, or panning, effects render at reduced width and height, then restore full detail on release (or after a 120 ms keyboard or wheel pause). Clicking without changing a slider, or attempting to zoom or pan past a limit, keeps full rendering quality. Effect radii use the full-quality output dimensions so the preview does not enlarge sharpening or bloom. Source textures are released on navigation or geometry changes. Variant exports still render the full-resolution source. Per-photo saves are debounced and ordered, and native sidecar writes run on blocking workers rather than the command thread. Crop changes the visible frame instead of adding a pixel shader.

Photo settings are read through [the editor state contract](../../src/features/editor/editor-state.ts) and [its store adapter](../../src/features/editor/adapters/store-state.ts). Per-photo edits and effects are kept in the local library and adjacent Warble sidecars; current Post settings are global and stored locally. See [Library and sync](02-library-and-sync.md) for portable data.

Clarity / Structure follows Dynamic Range in both Edit and Post. Clarity changes broader local contrast; Structure changes fine texture contrast. Both allow negative values for softening. The two amount sliders use fixed detail sizes with internal edge and noise safeguards; older saved values for the removed controls are ignored. The shader reuses source mipmaps and adjusts luminance in the current result, preserving monochrome and the preceding bloom and tone adjustments. Radii use the full-quality viewport dimensions during interaction previews. Zero amounts skip sampling. Photo values participate in copy/paste, reset, sidecars, and variant export; global values are included in Post presets, with neutral defaults for older saved data.

Analog Effects is the final tool in both Edit and Post. It provides vignetting, halation, and lateral chromatic aberration. [The final render pass](../../src/features/editor/rendering/analog-render-pass.ts) samples the completed edited image, applying photo Analog settings followed by Post Analog settings. Halation generates edited-image mipmaps only when needed; intermediate GPU targets are reused and released when the tool is inactive or the photo changes. Black-and-white Color settings also keep Analog output monochrome.

Analog settings follow the same persistence, copy/paste, reset, effect-toggle, sidecar, and preset paths as other effects. All amounts default to zero, which skips the extra rendering pass.

## Adding a tool

Follow one existing tool in [the editor tools folder](../../src/features/editor/tools/) before adding another.

1. Define its values and defaults in [the edit domain](../../src/domain/edits/). Decide whether they belong to a photo, Post, or both, and how they should be saved.
2. Add a tool controller and panel UI under [the editor tools folder](../../src/features/editor/tools/). Use [the tool contract](../../src/features/editor/tool.ts) for lifecycle, reset, and copy/paste behavior where relevant.
3. If it changes pixels, add a shader module in the same tool folder. The [render pipeline](../../src/features/editor/rendering/render-pipeline.ts) combines registered shaders; support neutral values so disabling a tool leaves the image unchanged. Geometry-only tools may not need a shader.
4. Expose new reads and writes through [the editor state contract](../../src/features/editor/editor-state.ts) and [store adapter](../../src/features/editor/adapters/store-state.ts). If the value is per-photo, cover its save, reload, reset, and Sync behavior.
5. Register its scope, order, controller, value reader, and optional shader in [the editor registry](../../src/features/editor/registry.ts). Check Edit and Post, toggling, navigation, and saving a variant as applicable.

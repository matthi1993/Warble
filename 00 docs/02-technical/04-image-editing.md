# Image editing

Editing changes how a decoded image is displayed; the original file remains unchanged.

## The pipeline

An image passes through four steps. All of them live in the rendering package.

```
image ──► geometry ──► stages on the GPU ──► output
          rotate       adjustments             view canvas
          crop         analog (photo, post)    or JPEG bytes
```

1. **Recipe.** [The recipe builder](../../packages/editing/src/recipe/recipe-builder.ts) turns edit state into a [render recipe](../../packages/render/src/recipe/render-recipe.ts): one layer of settings for the photo and one for the global Post look.
2. **Geometry.** [The image geometry](../../packages/render/src/geometry/image-geometry.ts) rotates the source and picks the crop region. Crop changes the visible frame instead of adding a pixel shader.
3. **Stages.** [The render pipeline](../../packages/render/src/pipeline/render-pipeline.ts) runs an ordered list of [stages](../../packages/render/src/pipeline/render-stage.ts). Each stage draws into a frame that the next one reads.
4. **Output.** [The image view](../../packages/render/src/view/image-view.ts) composites the result onto the screen canvas. [The exporter](../../packages/render/src/export/image-exporter.ts) encodes a JPEG.

The native backend provides image bytes or an embedded RAW preview. [The image viewer](../../app/src/viewer/image-viewer.ts) loads them and feeds the pipeline.

## Stages and effects

[The adjustment stage](../../packages/render/src/pipeline/adjustment-stage.ts) combines the shader effects into one WebGL program: bloom runs on the source first, followed by the photo layer and then the Post layer. This lets both Color tools apply saturation and black-and-white settings to the glow as well as the image. The order of effects within a layer comes from [the effect registry](../../packages/render/src/effects/effect-registry.ts). Changing a control updates shader values for the next draw, not the source file.

Clarity / Structure follows Dynamic Range in both Edit and Post. Clarity changes broader local contrast; Structure changes fine texture contrast. Both allow negative values for softening. The two amount sliders use fixed detail sizes with internal edge and noise safeguards; older saved values for the removed controls are ignored. The shader reuses source mipmaps and adjusts luminance in the current result, preserving monochrome and the preceding bloom and tone adjustments. Zero amounts skip sampling.

Analog Effects is the final tool in both Edit and Post. It provides vignetting, halation, and lateral chromatic aberration. [The analog stage](../../packages/render/src/effects/analog/analog-stage.ts) samples the completed image, once for the photo settings and once for the Post settings. Halation generates mipmaps only when needed; intermediate GPU targets are reused and released when no analog layer is active or the photo changes. Black-and-white Color settings also keep Analog output monochrome. All amounts default to zero, which skips the extra stages.

## Performance

The pipeline keeps the active photo's HD and full-resolution GPU textures so slider movements do not repeatedly upload the same pixels or rebuild mipmaps. Slider adjustments keep the full-resolution source when available. Source textures are released on navigation or geometry changes.

[The render quality policy](../../packages/render/src/view/render-quality.ts) reduces width and height during actual slider changes, zooming, or panning, then restores full detail on release or after a 120 ms keyboard or wheel pause. Clicking without changing a slider, or attempting to zoom or pan past a limit, keeps full rendering quality. Effect radii use the full-quality output dimensions so the preview does not enlarge sharpening, clarity, or bloom.

Variant exports always render the full-resolution source with the photo layer only.

## Edit state

[The editing context](../../packages/editing/src/editing-context.ts) bundles the stores. Settings are read and written by effect id, so a new effect needs no new store methods.

- [The photo edit store](../../packages/editing/src/photo/photo-edit-store.ts) holds per-photo crop and effect settings. Saves are debounced and ordered. They go to the local library and adjacent Warble sidecars; see [Library and sync](02-library-and-sync.md).
- [The Post store](../../packages/editing/src/post/post-process-store.ts) holds the global look, stored locally. [The preset store](../../packages/editing/src/presets/preset-store.ts) saves named looks.
- [The toggle store](../../packages/editing/src/toggles/effect-toggle-store.ts) switches effects off without discarding their values.

Photo values participate in copy and paste, reset, sidecars, and variant export. Post values are included in presets, with neutral defaults for older saved data.

## Adding an effect and its tool

Follow Grain as the smallest complete example.

1. **Effect.** Add a folder under [the effects folder](../../packages/render/src/effects/) with the settings, the shader fragment, and an effect class, like [the grain effect](../../packages/render/src/effects/grain/grain-effect.ts). Add its settings type to [the settings map](../../packages/render/src/recipe/render-recipe.ts) and register it in [the effect registry](../../packages/render/src/effects/effect-registry.ts). Neutral settings must leave the image unchanged.
2. **Persistence.** A per-photo effect also needs its id in [the photo effect table](../../packages/editing/src/photo/photo-effect-table.ts), because the saved shape is explicit. Post settings need nothing.
3. **Tool.** Add a tool class like [the grain tool](../../packages/editing/src/tools/grain-tool.ts) and register its scopes and order in [the tool registry](../../packages/editing/src/tools/tool-registry.ts).
4. **Card.** Add a card element and a renderer like [the grain card renderer](../../app/src/editor/tools/grain/grain-card-renderer.ts), then register it in [the tool cards](../../app/src/editor/tool-cards.ts).

Check Edit and Post, toggling, reset, copy and paste, navigation, and saving a variant.

## Other extension points

- **A multi-pass effect** that needs the finished image, like Analog, is a new [stage](../../packages/render/src/pipeline/render-stage.ts) added to the list in [the render pipeline](../../packages/render/src/pipeline/render-pipeline.ts).
- **A tool without a shader**, like Crop, extends [the edit tool](../../packages/editing/src/tools/edit-tool.ts) directly. It can own any state and contribute canvas overrides.
- **Feature extraction and AI tools** are not built yet. The intended fit: an analyser reads an image source and returns data such as a mask or detected regions; a tool stores the result in its settings; a stage or effect consumes it as a texture. The pipeline and both registries are open for this without changes to existing stages.

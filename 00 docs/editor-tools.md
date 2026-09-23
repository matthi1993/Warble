# Editor tools

Editing is organized as a feature rather than being split between the full
view, generic UI cards, stores, and the image canvas.

Each tool owns a folder under
[`src/features/editor/tools/`](../src/features/editor/tools/). Its UI, state
logic, and shader implementation are separate files:

```text
tools/color/
  color.ui.ts
  color.logic.ts
  color.shader.ts
```

The UI is controlled and contains no persistence decisions. The logic reads
and writes either per-photo values or global Post values. The shader file owns
the GLSL declarations, uniform binding, and the snippets applied in each scope.

[`registry.ts`](../src/features/editor/registry.ts) is the source of truth for
available tools, their order, supported scopes, and shader module. The Edit
panel and Post panel both create their tool lists from this registry. Crop is
photo-only because it changes geometry and canvas interaction rather than
pixel color.

All registered shader modules are composed into one WebGL program by
[`shader-composer.ts`](../src/features/editor/rendering/shader-composer.ts).
This preserves a single texture upload and an explicit processing order while
letting every tool keep its shader implementation locally. The resulting
program is managed by
[`render-pipeline.ts`](../src/features/editor/rendering/render-pipeline.ts).

Only JPEG variants are editable. The renderer consumes a decoded bitmap; RAW
sensor data is never sent to the editing pipeline.

To add a tool, create its UI, logic, and shader files, then add one entry to
[`EDITOR_TOOLS`](../src/features/editor/registry.ts). Declare whether it is
available for `photo`, `post`, or both. Generic controls should remain in
`src/ui/`; tool-specific components belong beside the tool.

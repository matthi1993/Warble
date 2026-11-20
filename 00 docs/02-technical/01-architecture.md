# Architecture

Warble has a TypeScript frontend and a Rust backend inside Tauri. The frontend is five reusable packages and one thin Lit app that composes them.

## Packages

Each package has one public entry file and knows nothing about Lit, Tauri, or the app.

| Package | Owns | Start at |
|---|---|---|
| `@warble/core` | Events, observable values, caches, debouncing, task tracking | [the entry file](../../packages/core/src/index.ts) |
| `@warble/render` | The image rendering pipeline: effects, GPU stages, geometry, view, export | [the render pipeline](../../packages/render/src/pipeline/render-pipeline.ts) |
| `@warble/editing` | Edit state, the Post look, presets, toggles, and tools | [the editing context](../../packages/editing/src/editing-context.ts) |
| `@warble/media` | Decoding, thumbnail and preview caches, request priorities | [the HD cache](../../packages/media/src/previews/hd-image-cache.ts) |
| `@warble/library` | Photos, folders, albums, ratings, EXIF, filtering | [the entry file](../../packages/library/src/index.ts) |

`editing` builds on `render` and `core`. `media` and `library` build on `core`. `render` and `core` depend on nothing.

A package reaches the outside world only through interfaces it declares, such as [the image backend](../../packages/media/src/ports/image-backend.ts) or [the edit repository](../../packages/editing/src/ports/edit-repository.ts). The app supplies the implementations.

## App

[The app](../../app/src/) is the only place that uses Lit or Tauri. Start at [the entry file](../../app/src/main.ts).

- [Composition](../../app/src/composition/app-context.ts) creates every shared object once. Views read their dependencies from it.
- [Platform](../../app/src/platform/platform.ts) lists everything the app needs from its host. [The Tauri platform](../../app/src/platform/tauri-platform.ts) is the only implementation, and this folder is the only one that imports Tauri.
- [Shell](../../app/src/shell/shell.ts) holds the sidebar, footer, menus, and library navigation. [The app element](../../app/src/shell/warble-app.ts) renders them.
- [Views](../../app/src/views/) contain the grid, detail panel, full view, and settings.
- [Editor](../../app/src/editor/tool-cards.ts) draws the tool cards, the Post panel, and presets.
- [Viewer](../../app/src/viewer/image-viewer.ts) connects loading, gestures, and edit state to the rendering package.
- [State](../../app/src/state/) holds app-only settings such as view state and cache settings.
- [UI](../../app/src/ui/) contains reusable visual controls.

Lit elements stay thin: they declare properties, render a template, and delegate. Behaviour lives in plain classes named `*-controller.ts` that do not import Lit, so the UI framework can be replaced without rewriting the logic.

[The native backend](../../src-tauri/src/lib.rs) owns file access, the library, metadata, and image work.

## Rules

[The structure check](../../scripts/check-structure.mjs) runs with `pnpm check` and fails when a rule is broken.

- No file is longer than 300 lines.
- Packages do not import Lit or Tauri.
- Tauri is imported only in the platform folder.
- State, platform, composition, and controller files do not import Lit.

Tests sit next to the code they cover, in each package's `tests` folder and in [the app tests](../../app/tests/). Run them with `pnpm test`.

## Where to look next

Use the feature pages for visible behaviour and the technical pages for data flow.

- [Library and sync](02-library-and-sync.md) covers folder scans, SQLite, and sidecars.
- [Images and background work](03-images-and-background-work.md) covers previews, caches, and task queues.
- [Image editing](04-image-editing.md) covers the rendering pipeline and how to extend it.
- [Frontend module structure](../refactor/01-frontend-modules.md) explains why the code is split this way.

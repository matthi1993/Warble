# Architecture

High-level overview of the **Warble** frontend codebase. This document
describes the layering rules, where to put new code, and which files
own which concerns.

For filesystem discovery, sidecar/SQLite reconciliation, and preview
priorities, see [Photo processing and folder sync](<00 docs/processing-pipeline-and-sync.md>).
The [documentation home](<00 docs/README.md>) links the user guides.

## Stack

- **Lit 3** web components (TypeScript 5.6, decorators).
- **Vite 6** for dev + build.
- **Tauri 2** for the desktop shell (macOS today; iOS scaffolding in
  `src-tauri/gen/apple`).
- Path aliases configured in both `tsconfig.json` and
  [vite.config.ts](vite.config.ts): `@domain/*`, `@services/*`, `@ui/*`,
  `@features/*`, `@app/*` → their corresponding `src/` folders.

## Layering

The core uses four concentric layers. Cross-layer product capabilities live
in `features/` and are composed by `app/`.

```
┌─────────────────────────────────────────────┐
│  app/        – views, shell, router         │
│  ┌───────────────────────────────────────┐  │
│  │  ui/        – presentational widgets  │  │
│  │  ┌─────────────────────────────────┐  │  │
│  │  │  services/  – IPC, stores       │  │  │
│  │  │  ┌───────────────────────────┐  │  │  │
│  │  │  │  domain/  – pure values   │  │  │  │
│  │  │  └───────────────────────────┘  │  │  │
│  │  └─────────────────────────────────┘  │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

### `src/domain/`

Pure, framework-free TypeScript values + helpers. **No IO, no Lit, no
Tauri.** Safe to consume from anywhere. Each subfolder ships its own
`index.ts` barrel.

- `photo/` — `Photo`, `PhotoFile`, `PhotoFormat`, variant selection
  helpers.
- `folder/` — `Folder`, tree-walking helpers.
- `edits/` — `CropEdit`, `ToneEdit`, `PhotoEdit`, aspect-ratio table,
  equality + zero-check helpers (`cropEditsEqual`, `isToneZero`).
- `rating/` — `PhotoRating`, `ColorLabel`, key-shortcut tables.
- `exif/` — `ExifMetadata`, section builders for the info card.

### `src/services/`

Cross-cutting business logic. Owns all Tauri `invoke()` calls and
in-memory stores. Stateful but UI-agnostic.

Conventions used by many stores in this layer:

- Singleton module-level state (`Map<id, value>`).
- `Set<Listener>` subscribe / unsubscribe pattern.
- Some writes are debounced and can be forced with `flushXxx` on navigation
  or before Sync. Ratings are serialized per photo and persisted immediately.

Subfolders:

- `edits/edits-store.ts` — per-photo crop + tone edits.
- `rating/rating-store.ts` — per-photo star + color label.
- `view-state/view-state-service.ts` — persisted bg/fit/sizing.
- `exif/exif-service.ts` — read EXIF metadata via `get_exif_metadata`.
- `effects/effects-store.ts` — per-photo shader effects.
- `post-process/` — global post-process values and presets.

### `src/ui/`

Presentational web components. **No business logic.** Props in, events
out. Each component lives in its own file and registers itself via
`@customElement`.

- `controls/` — generic buttons, sliders, theme toggle.
- `cards/` — `pf-card` (disclosure), `pf-info-row`, `pf-tone-slider-row`.
- `icons/` — SVG icon registry + `pf-icon`.
- `folders/` — folder tree row.
- `photos/` — image canvas, thumbnail card, rating overlay.

### `src/features/`

Vertical product features that combine domain values, services, UI, and
runtime behavior. Tool-specific code belongs here instead of being spread
across the generic layers.

- `editor/` — tool registry, shared tool contract, Edit/Post hosts, WebGL
  composition, and one folder per editing tool.

### `src/app/`

Application shell, route views, and orchestrators. Composes services
+ ui components. Knows about navigation, persistence, and feature
state machines.

- `main.ts` — bootstrap, registers `pf-app-shell`.
- `app-shell.ts` — top-level shell + router host.
- `router.ts` — view stack management.
- `views/full-view/` — modal photo viewer shell components (info, side panel,
  chrome render helpers, and scoped styles). Tool code lives in
  `src/features/editor/`.
- `photo-grid.ts`, `detail-panel.ts`, `folder-tree.ts`,
  `full-view.ts` — top-level views.
- `task-manager.ts`, `thumbnail-service.ts`, `hd-image-cache.ts`,
  `full-image-cache.ts`, `full-image-worker.ts` — on-demand image
  decoding and caching. The backend queue prioritises the active photo;
  the frontend modules deduplicate requests and own `ImageBitmap` lifetimes.
- `photo-processing-pipeline.ts` — staged metadata batches and bounded
  thumbnail warmup for the selected folder.
- `variant-store.ts` — file-format override store (still in `app/`
  because it sits between the variant store and on-disk preferences).

The native `src-tauri/src/library/` owns the catalog and folder scans;
`src-tauri/src/sidecar.rs` reconciles portable metadata with SQLite;
`src-tauri/src/tasks/` runs prioritized image work. These operations are
distinct from the frontend view and store layers.

## File size policy

- **Soft cap:** ~200 lines per file. Aim for single-responsibility
  modules.
- **Hard cap:** 500 lines, _except_ for genuinely cohesive units. Two
  documented exceptions exist today:
  - [src/ui/photos/pf-image-canvas.ts](src/ui/photos/pf-image-canvas.ts)
    (~2600 lines) — image loading, gesture controller, crop overlay, and hit
    testing remain coupled. WebGL tool rendering has moved to the editor
    feature.
  - [src/app/full-view.ts](src/app/full-view.ts) (~1100 lines) —
    central state machine for the full-screen viewer (navigation,
    edit tool state, persistence flush, cursor idle, EXIF sync). The
    cards, side panel, chrome (toolbar/bottombar), and styles are
    already extracted; what remains is tightly-coupled host state.

## Event flow

Web components communicate **upwards** via DOM `CustomEvent` (bubbling
+ composed). Parents read child state via property bindings (`.foo=`),
never DOM queries. Stores notify subscribers, which trigger Lit's
reactive update cycle by mutating `@state` fields.

Tauri `invoke()` calls live in `services/` for shared business state and
also in `app/` orchestration modules for library scans, selected-folder
metadata, and image loading. Keep presentational widgets in `ui/` free of
library policy.

## Adding new code

1. **New value type or pure helper?** → `src/domain/<area>/`.
2. **New IPC call or shared store?** → `src/services/<area>/`.
3. **New visual widget reused in >1 place?** → `src/ui/<category>/`.
4. **New editing tool?** → `src/features/editor/tools/<tool>/`, then register
   it in `src/features/editor/registry.ts`.
5. **New view or shell logic?** → `src/app/` (or `src/app/views/...`
   for sub-components of a specific view).

Always import via the alias closest to the consumer's layer, never
reach across with relative `../../`.

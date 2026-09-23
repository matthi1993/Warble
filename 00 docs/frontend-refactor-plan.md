# Frontend refactor plan

## Boundaries

- `domain/`: pure photo, folder, edit, rating and EXIF types/algorithms; no Lit, storage or IPC.
- `services/`: state, persistence, native IPC, task coordination, and image cache/loading. Organize by capability (`editing`, `library`, `images`, `tasks`, `settings`) rather than by whether a module was once part of `app/`.
- `features/editor/`: the tool contract, registry, tool controllers/cards and WebGL composition. Tools depend on an editor state port, not individual stores. New tools register once in the registry, but must still define their value format, persistence policy, UI and optional shader.
- `app/`: composition root, navigation and route hosts. Reusable `ui/` controls should receive data and emit events, never call persistence directly.

## Implementation sequence

1. Move app-root image loaders/caches, variant preferences, cache settings, task state, and photo processing into service capability folders. Update all consumers; do not leave forwarding modules.
2. Define an editor state port and a store-backed adapter. Inject it into tool instances and registry value readers through the composition root. Keep rendering registration in one registry.
3. Move canvas editing-state subscriptions into a dedicated adapter and relocate the stateful canvas and thumbnail loader to the image-viewer feature. Preserve the crop refit and HD-while-editing behavior. Longer term the canvas should accept edit snapshots as props and the viewer should own subscriptions; this requires coordinated changes to both full and detail view.
4. Check diagnostics and TypeScript without running the build. Verify no stale imports.

Steps 1–3 are implemented. The presentational-only canvas goal remains follow-up work: it is currently a feature renderer that owns interaction and image lifecycle, while the adapter owns store subscriptions and data access.

## Further work / risks

- The full-view host and app shell both mix view composition with asynchronous library and navigation workflows. Extract a viewer session controller and a library sync coordinator *after* integration coverage exists for navigation, sync cancellation, crop reset and before/after. Avoid a generic global event bus: typed store subscriptions and upward DOM events already give deterministic ownership.
- The image canvas is a stateful rendering engine (bitmap lifetime, gesture handling, WebGL, crop hit-testing), not a presentational primitive. Split its state adapter first; moving all its logic into Lit props in one step would risk frame timing and pan/zoom behavior. Likewise the photo grid's rating subscription and thumbnail card's loading belong in feature containers in a subsequent pass.
- Keep active-image decode and WebGL editing on the client: IPC transfer of full bitmaps on every slider drag would hurt latency. Native Rust is appropriate for library scans, thumbnail/HD generation, metadata/EXIF, SQLite persistence and batched folder-sidecar reconciliation. Profile before moving more pixel processing; background export/batch renders are plausible native candidates, but require a consistent implementation of the editor shaders.
- Backing stores are split across SQLite and localStorage. Before migrating post-processing or enable flags into SQLite, define portability and migration requirements; do not silently change existing user preferences.

# Architecture

Warble has a Lit and TypeScript frontend and a Rust backend inside Tauri.

## Main boundaries

Each area has a clear role; follow these boundaries when adding code.

- [App](../../src/app/) composes the views and coordinates navigation. Start at [the app shell](../../src/app/app-shell.ts).
- [Features](../../src/features/) contain stateful product behavior, such as the editor and image viewer.
- [Services](../../src/services/) hold shared state, loading, persistence, and native calls.
- [UI](../../src/ui/) contains reusable visual controls.
- [Domain](../../src/domain/) contains photo, folder, rating, and edit values without UI or IO.
- [Native backend](../../src-tauri/src/lib.rs) owns file access, the library, metadata, and image work.

## Where to look next

Use the feature pages for visible behavior and the technical pages for data flow.

- [Library and sync](02-library-and-sync.md) covers folder scans, SQLite, and sidecars.
- [Images and background work](03-images-and-background-work.md) covers previews, rendering, and task queues.
- [Image editing](04-image-editing.md) covers rendering and adding a tool.
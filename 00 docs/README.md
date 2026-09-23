# Warble documentation

Start with the [app overview](app-overview.md) to understand the workflow, or
go straight to the topic you need. The guides describe what the app does; the
implementation references explain how the frontend and native backend do it.

## Table of contents

### Using Warble

1. [App overview](app-overview.md) — what the app does and where to begin.
2. [Views and navigation](views-and-navigation.md) — sidebar, grid, detail,
   full view, and keyboard navigation.
3. [Library and browsing](library-and-browsing.md) — adding/reconnecting
   folders, Sync, filters, variants, ratings, and resetting the workspace.
4. [Image loading and background work](image-loading-and-background-work.md) —
   preview behavior, cache settings, and task status from a user's perspective.
5. [Editor tools](editor-tools.md) — editing model and tool structure.

### Maintaining Warble

6. [Photo processing and folder sync](processing-pipeline-and-sync.md) — the
   stage-by-stage pipeline, filesystem/SQLite/sidecar ownership, Sync,
   writeback, priorities, and cache invalidation.
7. [Code architecture](../architecture.md) — project layers and where new code
   belongs.

The [project README](../README.md) covers setup and packaging. When changing
folder or metadata behavior, update the user guide and the
[processing reference](processing-pipeline-and-sync.md) together so the
observed behavior and implementation stay aligned.
# Warble

![App Icon](app-icon.png)

Warble is photo viewer with small editing and presentation features built for mac. Built with Vite, TypeScript, and Tauri.

## Documentation

- [App overview](<00 docs/app-overview.md>)
- [Views and navigation](<00 docs/views-and-navigation.md>)
- [Library and browsing](<00 docs/library-and-browsing.md>)
- [Image loading and background work](<00 docs/image-loading-and-background-work.md>)
- [Editor tools](<00 docs/editor-tools.md>)
- [Architecture](architecture.md)

## Getting Started

To start the app in development mode:

```sh
pnpm install
pnpm dev
```

## Build

To build the Tauri desktop app:

```sh
pnpm tauri build
pnpm tauri ios build
```

### Running the Production App on macOS

After building, you can find the macOS app in the `src-tauri/target/release/bundle/macos/` folder. Double-click the `.app` file to launch Warble on your Mac.

A fast, native photo viewer built with Tauri + Lit.

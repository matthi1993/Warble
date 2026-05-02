# Warble — Photo Viewer

A fast, native photo viewer built with Tauri + Lit. Branding inspired by
the Australian magpie: monochrome plumage with a vivid orange shutter eye.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## App icon

The brand mark lives at [src/ui/styles/warble-mark.svg](src/ui/styles/warble-mark.svg).
To regenerate the macOS / Windows / Linux bundle icons under `src-tauri/icons/`
from a high-res 1024×1024 PNG of the logo, run:

```sh
pnpm tauri icon path/to/warble-logo-1024.png
```

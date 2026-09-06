# Warble

![App Icon](app-icon.png)

#This is a work in progress. The App was build using AI.#

Warble is photo viewer with small editing and presentation features built for mac. Built with Vite, TypeScript, and Tauri.

## Portable libraries

A `.warble` file contains the catalog, ratings, edits, and settings. Photos
remain in their original folders and are addressed by portable root IDs plus
relative paths. Each Mac or iPad remembers its own locations for those roots.

To use one library from an external drive and over the network:

1. Share the drive's library/photo folder from the Mac using SMB.
2. On iPad, connect to the Mac in Files using **Connect to Server**.
3. Open the `.warble` file from the SMB share in Warble.
4. Use **Reconnect Folder** and select the corresponding SMB photo folder.
5. Use **Save** to update the opened library. **Save As…** creates a separate
   library snapshot.

Warble works on an app-local SQLite copy and writes a clean snapshot back when
you save. This avoids running SQLite directly on an external drive or SMB file
provider. Use a shared library on one device at a time: if another device
changes the file after it was opened, Warble blocks the overwrite and asks you
to reopen it or save the local work under another name.

## Getting Started

To start the app in development mode:

```sh
pnpm install
pnpm dev
```

## Build

```sh
pnpm build
```

To build the Tauri desktop app:

```sh
pnpm tauri build
pnpm tauri ios build
```

### Running the App on macOS

After building, you can find the macOS app in the `src-tauri/target/release/bundle/macos/` folder. Double-click the `.app` file to launch Warble on your Mac.

A fast, native photo viewer built with Tauri + Lit.

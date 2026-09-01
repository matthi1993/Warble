fn main() {
    tauri_plugin::Builder::new(&[
        "pickFolders",
        "pickLibrary",
        "resolveBookmark",
        "replaceLibrary",
    ])
    .ios_path("ios")
    .build();
}

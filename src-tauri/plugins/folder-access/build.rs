fn main() {
    tauri_plugin::Builder::new(&[
        "pickFolders",
        "pickLibrary",
        "exportLibrary",
        "resolveBookmark",
        "replaceLibrary",
    ])
    .ios_path("ios")
    .build();
}

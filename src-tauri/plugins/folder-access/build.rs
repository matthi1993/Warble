fn main() {
    tauri_plugin::Builder::new(&[
        "pickFolders",
        "pickLibrary",
        "exportLibrary",
        "resolveBookmark",
        "prepareFolder",
        "replaceLibrary",
        "trashFiles",
        "openIn",
    ])
    .ios_path("ios")
    .build();
}

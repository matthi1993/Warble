fn main() {
    tauri_plugin::Builder::new(&[
        "pickFolders",
        "pickLibrary",
        "exportLibrary",
        "resolveBookmark",
        "replaceLibrary",
        "trashFiles",
        "openIn",
    ])
    .ios_path("ios")
    .build();
}

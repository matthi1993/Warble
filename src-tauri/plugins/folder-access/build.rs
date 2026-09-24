fn main() {
    tauri_plugin::Builder::new(&[
        "pickFolders",
        "resolveBookmark",
        "prepareFolder",
        "trashFiles",
        "openIn",
    ])
    .ios_path("ios")
    .build();
}

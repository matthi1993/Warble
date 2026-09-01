// swift-tools-version:5.3
import PackageDescription

let package = Package(
  name: "tauri-plugin-folder-access",
  platforms: [.iOS(.v14)],
  products: [.library(name: "tauri-plugin-folder-access", type: .static, targets: ["tauri-plugin-folder-access"])],
  dependencies: [.package(name: "Tauri", path: "../.tauri/tauri-api")],
  targets: [.target(name: "tauri-plugin-folder-access", dependencies: [.byName(name: "Tauri")], path: "Sources")]
)

import Tauri
import UIKit
import UniformTypeIdentifiers

struct PickFoldersArgs: Decodable { let multiple: Bool }
struct ResolveBookmarkArgs: Decodable { let bookmark: String }
struct ReplaceLibraryArgs: Decodable { let source: String; let destination: String }
struct ExportLibraryArgs: Decodable { let source: String }

final class FolderAccessPlugin: Plugin, UIDocumentPickerDelegate {
  private var pending: Invoke?
  private var pickingLibrary = false

  @objc func pickFolders(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PickFoldersArgs.self)
    guard pending == nil else {
      invoke.reject("A folder picker is already open")
      return
    }
    pending = invoke
    pickingLibrary = false
    DispatchQueue.main.async {
      if #available(iOS 14.0, *) {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
        picker.delegate = self
        picker.allowsMultipleSelection = args.multiple
        picker.modalPresentationStyle = .fullScreen
        self.manager.viewController?.present(picker, animated: true)
      } else {
        self.pending = nil
        invoke.reject("Folder selection requires iOS 14 or later")
      }
    }
  }

  @objc func pickLibrary(_ invoke: Invoke) throws {
    guard pending == nil else {
      invoke.reject("A document picker is already open")
      return
    }
    pending = invoke
    pickingLibrary = true
    DispatchQueue.main.async {
      if #available(iOS 14.0, *) {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: false)
        picker.delegate = self
        picker.allowsMultipleSelection = false
        picker.modalPresentationStyle = .fullScreen
        self.manager.viewController?.present(picker, animated: true)
      } else {
        self.pending = nil
        invoke.reject("Opening a library requires iOS 14 or later")
      }
    }
  }

  @objc func exportLibrary(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ExportLibraryArgs.self)
    guard pending == nil else {
      invoke.reject("A document picker is already open")
      return
    }
    pending = invoke
    pickingLibrary = true
    let source = URL(fileURLWithPath: args.source)
    DispatchQueue.main.async {
      if #available(iOS 14.0, *) {
        let picker = UIDocumentPickerViewController(forExporting: [source], asCopy: true)
        picker.delegate = self
        picker.allowsMultipleSelection = false
        picker.modalPresentationStyle = .fullScreen
        self.manager.viewController?.present(picker, animated: true)
      } else {
        self.pending = nil
        self.pickingLibrary = false
        invoke.reject("Saving a library requires iOS 14 or later")
      }
    }
  }

  @objc func resolveBookmark(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ResolveBookmarkArgs.self)
    guard let data = Data(base64Encoded: args.bookmark) else {
      invoke.reject("Invalid folder bookmark")
      return
    }
    var stale = false
    do {
      let url = try URL(
        resolvingBookmarkData: data,
        options: [],
        relativeTo: nil,
        bookmarkDataIsStale: &stale
      )
      guard url.startAccessingSecurityScopedResource() else {
        invoke.reject("Folder permission is no longer valid")
        return
      }
      let currentBookmark = stale
        ? try url.bookmarkData(
            options: [],
            includingResourceValuesForKeys: nil,
            relativeTo: nil
          )
        : data
      invoke.resolve([
        "path": url.path,
        "bookmark": currentBookmark.base64EncodedString()
      ])
    } catch {
      invoke.reject(error.localizedDescription)
    }
  }

  @objc func replaceLibrary(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ReplaceLibraryArgs.self)
    let source = URL(fileURLWithPath: args.source)
    let destination = URL(fileURLWithPath: args.destination)
    let coordinator = NSFileCoordinator()
    var coordinationError: NSError?
    var operationError: Error?
    coordinator.coordinate(writingItemAt: destination, options: .forReplacing, error: &coordinationError) { target in
      do {
        _ = try FileManager.default.replaceItemAt(
          target,
          withItemAt: source,
          backupItemName: nil,
          options: []
        )
      } catch {
        operationError = error
      }
    }
    if let error = coordinationError ?? operationError as NSError? {
      invoke.reject(error.localizedDescription)
    } else {
      do {
        let bookmark = try destination.bookmarkData(
          options: [],
          includingResourceValuesForKeys: nil,
          relativeTo: nil
        )
        invoke.resolve([
          "path": destination.path,
          "bookmark": bookmark.base64EncodedString()
        ])
      } catch {
        invoke.reject("The library was saved, but its permission could not be renewed: \(error.localizedDescription)")
      }
    }
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    guard let invoke = pending else { return }
    pending = nil
    let wasPickingLibrary = pickingLibrary
    pickingLibrary = false
    do {
      let folders = try urls.map { url -> [String: String] in
        guard url.startAccessingSecurityScopedResource() else {
          throw NSError(domain: "FolderAccess", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not access selected folder"])
        }
        let bookmark = try url.bookmarkData(
          options: [],
          includingResourceValuesForKeys: nil,
          relativeTo: nil
        )
        return ["path": url.path, "bookmark": bookmark.base64EncodedString()]
      }
      if wasPickingLibrary {
        invoke.resolve(["selection": folders.first])
      } else {
        invoke.resolve(["folders": folders])
      }
    } catch {
      invoke.reject(error.localizedDescription)
    }
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    if pickingLibrary {
      pending?.resolve(["selection": nil])
    } else {
      pending?.resolve(["folders": []])
    }
    pending = nil
    pickingLibrary = false
  }
}

@_cdecl("init_plugin_folder_access")
func initPluginFolderAccess() -> Plugin { FolderAccessPlugin() }

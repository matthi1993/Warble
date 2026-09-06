import Tauri
import UIKit
import UniformTypeIdentifiers

struct PickFoldersArgs: Decodable { let multiple: Bool }
struct ResolveBookmarkArgs: Decodable { let bookmark: String }
struct ReplaceLibraryArgs: Decodable { let source: String; let destination: String }
struct ExportLibraryArgs: Decodable { let source: String }
struct TrashFilesArgs: Decodable { let paths: [String] }
struct OpenInArgs: Decodable { let path: String }

final class FolderAccessPlugin: Plugin, UIDocumentPickerDelegate {
  private var pending: Invoke?
  private var pickingLibrary = false
  private let resourceLock = NSLock()
  private var activeResources: [String: URL] = [:]

  deinit {
    resourceLock.lock()
    let resources = Array(activeResources.values)
    activeResources.removeAll()
    resourceLock.unlock()
    resources.forEach { $0.stopAccessingSecurityScopedResource() }
  }

  /// Keep one balanced security-scope access alive for each selected URL.
  /// Folder descendants remain readable after the picker callback returns.
  private func retainSecurityScope(for url: URL) -> Bool {
    resourceLock.lock()
    defer { resourceLock.unlock() }
    if activeResources[url.path] != nil {
      return true
    }
    guard url.startAccessingSecurityScopedResource() else {
      return false
    }
    activeResources[url.path] = url
    return true
  }

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
      guard retainSecurityScope(for: url) else {
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

  @objc func prepareFolder(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ResolveBookmarkArgs.self)
    guard let data = Data(base64Encoded: args.bookmark) else {
      invoke.reject("Invalid folder bookmark")
      return
    }

    DispatchQueue.global(qos: .userInitiated).async {
      var stale = false
      do {
        let url = try URL(
          resolvingBookmarkData: data,
          options: [],
          relativeTo: nil,
          bookmarkDataIsStale: &stale
        )
        guard self.retainSecurityScope(for: url) else {
          invoke.reject("Folder permission is no longer valid")
          return
        }
        let entryCount = try self.prepareFolderEnumeration(at: url)
        let currentBookmark = stale
          ? try url.bookmarkData(
              options: [],
              includingResourceValuesForKeys: nil,
              relativeTo: nil
            )
          : data
        invoke.resolve([
          "path": url.path,
          "bookmark": currentBookmark.base64EncodedString(),
          "entryCount": entryCount
        ])
      } catch {
        invoke.reject("Could not read the selected folder: \(error.localizedDescription)")
      }
    }
  }

  /// NSFileCoordinator gives SMB/File Provider extensions time to fetch each
  /// directory listing. Walking the enumerator here warms those listings for
  /// the portable Rust catalog scan that follows.
  private func prepareFolderEnumeration(at url: URL) throws -> Int {
    let emptyRetryDelays: [TimeInterval] = [0.2, 0.5, 1.0, 2.0]
    for attempt in 0...emptyRetryDelays.count {
      let entryCount = try coordinateFolderEnumeration(at: url)
      if entryCount > 0 || attempt == emptyRetryDelays.count {
        return entryCount
      }
      // Some SMB File Providers report an empty successful listing while
      // asynchronously fetching the real directory. Re-coordinate after a
      // short delay instead of accepting a permanently blank library root.
      Thread.sleep(forTimeInterval: emptyRetryDelays[attempt])
    }
    return 0
  }

  private func coordinateFolderEnumeration(at url: URL) throws -> Int {
    let coordinator = NSFileCoordinator()
    var coordinationError: NSError?
    var enumerationError: Error?
    var entryCount = 0
    coordinator.coordinate(
      readingItemAt: url,
      options: .withoutChanges,
      error: &coordinationError
    ) { coordinatedURL in
      let keys: [URLResourceKey] = [.isDirectoryKey, .isRegularFileKey]
      var providerError: Error?
      guard let enumerator = FileManager.default.enumerator(
        at: coordinatedURL,
        includingPropertiesForKeys: keys,
        options: [.skipsHiddenFiles],
        errorHandler: { _, error in
          providerError = error
          return false
        }
      ) else {
        enumerationError = NSError(
          domain: "FolderAccess",
          code: 2,
          userInfo: [NSLocalizedDescriptionKey: "The folder could not be enumerated"]
        )
        return
      }

      do {
        for case let itemURL as URL in enumerator {
          _ = try itemURL.resourceValues(forKeys: Set(keys))
          entryCount += 1
        }
        if let providerError = providerError {
          throw providerError
        }
      } catch {
        enumerationError = error
      }
    }

    if let error = coordinationError ?? enumerationError as NSError? {
      throw error
    }
    return entryCount
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

  @objc func trashFiles(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(TrashFilesArgs.self)
    DispatchQueue.global(qos: .userInitiated).async {
      for path in args.paths {
        let url = URL(fileURLWithPath: path)
        let coordinator = NSFileCoordinator()
        var coordinationError: NSError?
        var operationError: Error?
        coordinator.coordinate(writingItemAt: url, options: .forDeleting, error: &coordinationError) { target in
          do {
            try FileManager.default.removeItem(at: target)
          } catch {
            operationError = error
          }
        }
        if let error = coordinationError ?? operationError as NSError? {
          invoke.reject(error.localizedDescription)
          return
        }
      }
      invoke.resolve(["success": true])
    }
  }

  @objc func openIn(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(OpenInArgs.self)
    DispatchQueue.main.async {
      guard let presenter = self.manager.viewController else {
        invoke.reject("The Open In sheet could not be presented")
        return
      }
      let url = URL(fileURLWithPath: args.path)
      let controller = UIActivityViewController(activityItems: [url], applicationActivities: nil)
      if let popover = controller.popoverPresentationController {
        popover.sourceView = presenter.view
        popover.sourceRect = CGRect(
          x: presenter.view.bounds.midX,
          y: presenter.view.bounds.midY,
          width: 1,
          height: 1
        )
        popover.permittedArrowDirections = []
      }
      controller.completionWithItemsHandler = { _, _, _, _ in
        invoke.resolve(["success": true])
      }
      presenter.present(controller, animated: true)
    }
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    guard let invoke = pending else { return }
    pending = nil
    let wasPickingLibrary = pickingLibrary
    pickingLibrary = false
    do {
      let folders = try urls.map { url -> [String: String] in
        guard retainSecurityScope(for: url) else {
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

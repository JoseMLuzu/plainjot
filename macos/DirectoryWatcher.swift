import Foundation
import Darwin

final class DirectoryWatcher {
    private let directoryURL: URL
    private let debounceInterval: DispatchTimeInterval
    private let onChange: () -> Void
    private let queue = DispatchQueue(label: "io.github.josemluzu.plainjot.watcher")
    private var source: DispatchSourceFileSystemObject?
    private var pendingChange: DispatchWorkItem?

    init(
        directoryURL: URL,
        debounceInterval: DispatchTimeInterval = .milliseconds(300),
        onChange: @escaping () -> Void
    ) {
        self.directoryURL = directoryURL
        self.debounceInterval = debounceInterval
        self.onChange = onChange
    }

    func start() throws {
        var startError: Error?
        queue.sync {
            do { try startOnQueue() }
            catch { startError = error }
        }
        if let startError { throw startError }
    }

    func stop() {
        queue.async { [weak self] in
            self?.pendingChange?.cancel()
            self?.pendingChange = nil
            self?.source?.cancel()
            self?.source = nil
        }
    }

    private func startOnQueue() throws {
        guard source == nil else { return }
        let descriptor = open(directoryURL.path, O_EVTONLY)
        guard descriptor >= 0 else {
            throw StoreFailure(status: 500, message: "No se pudo observar la carpeta PlainJot")
        }

        let watcher = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: descriptor,
            eventMask: [.write, .delete, .rename, .extend, .attrib, .link, .revoke],
            queue: queue
        )
        watcher.setCancelHandler { close(descriptor) }
        watcher.setEventHandler { [weak self, weak watcher] in
            guard let self, let flags = watcher?.data else { return }
            self.scheduleChange()
            if !flags.intersection([.delete, .rename, .revoke]).isEmpty {
                self.restartAfterDirectoryChange()
            }
        }
        source = watcher
        watcher.resume()
    }

    private func scheduleChange() {
        pendingChange?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.onChange() }
        pendingChange = work
        queue.asyncAfter(deadline: .now() + debounceInterval, execute: work)
    }

    private func restartAfterDirectoryChange() {
        source?.cancel()
        source = nil
        queue.asyncAfter(deadline: .now() + .milliseconds(600)) { [weak self] in
            guard let self else { return }
            try? FileManager.default.createDirectory(at: self.directoryURL, withIntermediateDirectories: true)
            try? self.startOnQueue()
        }
    }

    deinit {
        pendingChange?.cancel()
        source?.cancel()
    }
}

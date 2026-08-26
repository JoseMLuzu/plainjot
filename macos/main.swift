@preconcurrency import AppKit
@preconcurrency import WebKit
import Foundation
import Darwin

final class NotesBridge: NSObject, WKScriptMessageHandler {
    private let store: PlainJotStore
    weak var webView: WKWebView?

    init(store: PlainJotStore) {
        self.store = store
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard
            let payload = message.body as? [String: Any],
            let id = payload["id"] as? String,
            let method = payload["method"] as? String,
            let path = payload["path"] as? String
        else {
            return
        }

        let requestBody: Any?
        if payload["body"] is NSNull { requestBody = nil }
        else { requestBody = payload["body"] }

        do {
            let response = try store.route(method: method, path: path, body: requestBody)
            resolve(id: id, status: response.status, body: response.body)
        } catch let failure as StoreFailure {
            resolve(id: id, status: failure.status, body: ["error": failure.message])
        } catch {
            resolve(id: id, status: 500, body: ["error": "No se pudo acceder a la carpeta PlainJot"])
        }
    }

    private func resolve(id: String, status: Int, body: Any?) {
        var packet: [String: Any] = ["id": id, "status": status]
        packet["body"] = body ?? NSNull()
        guard
            JSONSerialization.isValidJSONObject(packet),
            let data = try? JSONSerialization.data(withJSONObject: packet),
            let json = String(data: data, encoding: .utf8)
        else { return }
        webView?.evaluateJavaScript("window.__nativeNotesResolve(\(json));")
    }
}

final class NavigationDelegate: NSObject, WKNavigationDelegate {
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if
            navigationAction.navigationType == .linkActivated,
            let url = navigationAction.request.url,
            ["http", "https"].contains(url.scheme?.lowercased() ?? "")
        {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
}

final class JavaScriptDialogDelegate: NSObject, WKUIDelegate {
    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = message
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Eliminar")
        alert.addButton(withTitle: "Cancelar")

        guard let window = webView.window else {
            completionHandler(alert.runModal() == .alertFirstButtonReturn)
            return
        }
        alert.beginSheetModal(for: window) { response in
            completionHandler(response == .alertFirstButtonReturn)
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow?
    private var webView: WKWebView?
    private var bridge: NotesBridge?
    private var directoryWatcher: DirectoryWatcher?
    private let navigationDelegate = NavigationDelegate()
    private let javaScriptDialogDelegate = JavaScriptDialogDelegate()

    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            createApplicationMenu()
            try createWindow()
            NSApplication.shared.activate(ignoringOtherApps: true)
        } catch {
            let alert = NSAlert(error: error)
            alert.messageText = "No se pudo abrir PlainJot"
            alert.runModal()
            NSApplication.shared.terminate(nil)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationWillTerminate(_ notification: Notification) {
        directoryWatcher?.stop()
    }

    @objc private func createNewNote(_ sender: Any?) {
        webView?.evaluateJavaScript("createNote();")
    }

    @objc private func createNewTask(_ sender: Any?) {
        webView?.evaluateJavaScript("createTask();")
    }

    private func createApplicationMenu() {
        let mainMenu = NSMenu()

        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Acerca de PlainJot", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Salir de PlainJot", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        mainMenu.addItem(appItem)

        let fileItem = NSMenuItem()
        let fileMenu = NSMenu(title: "Archivo")
        let newNote = NSMenuItem(title: "Nueva nota", action: #selector(createNewNote(_:)), keyEquivalent: "n")
        newNote.target = self
        fileMenu.addItem(newNote)
        let newTask = NSMenuItem(title: "Nueva tarea", action: #selector(createNewTask(_:)), keyEquivalent: "n")
        newTask.keyEquivalentModifierMask = [.command, .shift]
        newTask.target = self
        fileMenu.addItem(newTask)
        fileItem.submenu = fileMenu
        mainMenu.addItem(fileItem)

        NSApplication.shared.mainMenu = mainMenu
    }

    private func createWindow() throws {
        let notesDirectory = preferredNotesDirectory()
        let store = try PlainJotStore(directoryURL: notesDirectory)

        guard
            let webDirectory = Bundle.main.resourceURL?.appendingPathComponent("Web", isDirectory: true),
            let indexURL = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Web"),
            let bridgeURL = Bundle.main.url(forResource: "native-bridge", withExtension: "js")
        else {
            throw StoreFailure(status: 500, message: "Faltan recursos de la aplicación")
        }

        let bridgeSource = try String(contentsOf: bridgeURL, encoding: .utf8)
        let controller = WKUserContentController()
        controller.addUserScript(WKUserScript(source: bridgeSource, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        let notesBridge = NotesBridge(store: store)
        controller.add(notesBridge, name: "notes")

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller
        configuration.websiteDataStore = .default()

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = navigationDelegate
        webView.uiDelegate = javaScriptDialogDelegate
        notesBridge.webView = webView
        webView.loadFileURL(indexURL, allowingReadAccessTo: webDirectory)

        let watcher = DirectoryWatcher(directoryURL: store.directoryURL) { [weak webView] in
            DispatchQueue.main.async {
                webView?.evaluateJavaScript("window.__plainjotFilesChanged?.();")
            }
        }
        try watcher.start()

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1120, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "PlainJot"
        window.minSize = NSSize(width: 760, height: 540)
        window.setFrameAutosaveName("PlainJotMainWindow")
        window.contentView = webView
        window.center()
        window.makeKeyAndOrderFront(nil)

        directoryWatcher = watcher
        bridge = notesBridge
        self.webView = webView
        self.window = window
    }

    private func preferredNotesDirectory() -> URL {
        let documents = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Documents", isDirectory: true)
        let preferred = documents.appendingPathComponent("PlainJot", isDirectory: true)
        let legacy = documents.appendingPathComponent("NotasLocal", isDirectory: true)
        let fileManager = FileManager.default

        if fileManager.fileExists(atPath: preferred.path) || !fileManager.fileExists(atPath: legacy.path) {
            return preferred
        }
        do {
            try fileManager.moveItem(at: legacy, to: preferred)
            return preferred
        } catch {
            return legacy
        }
    }
}

private func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    guard condition() else { throw StoreFailure(status: 500, message: message) }
}

private func requireStoreFailure(status: Int, _ operation: () throws -> Void) throws {
    do {
        try operation()
        throw StoreFailure(status: 500, message: "Se esperaba un error controlado")
    } catch let failure as StoreFailure where failure.status == status {
        return
    }
}

func runSelfTest() throws {
    let testDirectory = FileManager.default.temporaryDirectory
        .appendingPathComponent("plainjot-self-test-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: testDirectory) }

    let store = try PlainJotStore(directoryURL: testDirectory)
    let created = try store.route(
        method: "POST",
        path: "/api/notes",
        body: ["title": "Prueba nativa", "body": "Contenido local"]
    )
    guard let note = created.body as? [String: Any], let noteID = note["id"] as? String else {
        throw StoreFailure(status: 500, message: "Falló la creación nativa")
    }
    try require(created.status == 201, "Estado incorrecto al crear una nota")
    try requireStoreFailure(status: 400) {
        _ = try store.getDocument("../outside.md")
    }

    let outsideURL = testDirectory.deletingLastPathComponent()
        .appendingPathComponent("plainjot-outside-\(UUID().uuidString).md")
    let linkedURL = testDirectory.appendingPathComponent("linked.md")
    try "# Outside\n".write(to: outsideURL, atomically: true, encoding: .utf8)
    defer { try? FileManager.default.removeItem(at: outsideURL) }
    try FileManager.default.createSymbolicLink(at: linkedURL, withDestinationURL: outsideURL)
    try requireStoreFailure(status: 400) {
        _ = try store.getDocument("linked.md")
    }
    try FileManager.default.removeItem(at: linkedURL)

    let conflict = try store.createNote(title: "Conflicto", body: "Versión local")
    guard let conflictID = conflict["id"] as? String, let revision = conflict["revision"] as? String else {
        throw StoreFailure(status: 500, message: "Falló la preparación del conflicto")
    }
    let conflictURL = testDirectory.appendingPathComponent(conflictID)
    try "# Conflicto\n\nVersión externa más larga.\n".write(to: conflictURL, atomically: true, encoding: .utf8)
    try requireStoreFailure(status: 409) {
        _ = try store.updateDocument(
            conflictID,
            title: "Conflicto",
            body: "No sobrescribir",
            expectedRevision: revision
        )
    }
    let conflictContents = try String(contentsOf: conflictURL, encoding: .utf8)
    try require(conflictContents.contains("Versión externa"), "Se sobrescribió un cambio externo")

    let taskResponse = try store.route(
        method: "POST",
        path: "/api/tasks",
        body: [
            "title": "Tarea desde agente",
            "body": "Contenido Markdown",
            "project": "plainjot",
            "source": "codex",
        ]
    )
    guard let task = taskResponse.body as? [String: Any], let taskID = task["id"] as? String else {
        throw StoreFailure(status: 500, message: "Falló la creación de tareas")
    }
    try require(task["status"] as? String == "inbox", "La tarea no entró en Inbox")

    let externalURL = testDirectory.appendingPathComponent("external-task.md")
    let externalTask = """
    ---
    type: task
    status: inbox
    project: external
    source: claude-code
    created: 2026-08-24T22:30:00Z
    completed:
    ---

    # External task

    Written outside the app.
    """
    try externalTask.write(to: externalURL, atomically: true, encoding: .utf8)
    let tasks = try store.listTasks()
    try require(tasks.count == 2, "No se detectó la tarea externa")

    let todo = try store.route(
        method: "PATCH",
        path: "/api/tasks/\(taskID)",
        body: ["status": "todo"]
    )
    try require((todo.body as? [String: Any])?["status"] as? String == "todo", "Falló inbox → todo")
    let done = try store.route(
        method: "PATCH",
        path: "/api/tasks/\(taskID)",
        body: ["status": "done"]
    )
    try require((done.body as? [String: Any])?["status"] as? String == "done", "Falló todo → done")

    let watcherSignal = DispatchSemaphore(value: 0)
    let watcher = DirectoryWatcher(directoryURL: testDirectory, debounceInterval: .milliseconds(80)) {
        watcherSignal.signal()
    }
    try watcher.start()
    let watchedURL = testDirectory.appendingPathComponent("watched-note.md")
    try "# Watched\n\nExternal change.\n".write(to: watchedURL, atomically: true, encoding: .utf8)
    try require(watcherSignal.wait(timeout: .now() + 3) == .success, "El filesystem watcher no respondió")
    watcher.stop()

    let updated = try store.route(
        method: "PUT",
        path: "/api/documents/\(noteID)",
        body: ["title": "Prueba actualizada", "body": "Nuevo contenido"]
    )
    try require((updated.body as? [String: Any])?["title"] as? String == "Prueba actualizada", "Falló la edición nativa")

    _ = try store.route(method: "DELETE", path: "/api/documents/\(noteID)", body: nil)
    try require(!FileManager.default.fileExists(atPath: testDirectory.appendingPathComponent(noteID).path), "Falló el borrado nativo")
    print("Prueba nativa completada correctamente")
}

if CommandLine.arguments.contains("--self-test") {
    do {
        try runSelfTest()
        exit(0)
    } catch {
        fputs("\(error.localizedDescription)\n", stderr)
        exit(1)
    }
}

let application = NSApplication.shared
let applicationDelegate = AppDelegate()
application.setActivationPolicy(.regular)
application.delegate = applicationDelegate
application.run()

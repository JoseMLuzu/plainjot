@preconcurrency import AppKit
@preconcurrency import WebKit
import Foundation
import Darwin
import UniformTypeIdentifiers

// Only generated, inert SVG geometry can be exported; never scripts or file references.
private final class WhiteboardSVGValidator: NSObject, XMLParserDelegate {
    private(set) var valid = true
    private(set) var rootIsSVG = false
    private var depth = 0
    private let tags: Set<String> = ["svg", "title", "rect", "circle", "polyline", "line", "text", "tspan"]
    private let attributes: Set<String> = ["xmlns", "width", "height", "viewBox", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "dy", "points", "stroke", "stroke-width", "fill", "stroke-linecap", "stroke-linejoin", "font-family", "font-size", "dominant-baseline"]
    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes values: [String: String]) {
        if depth == 0 { rootIsSVG = elementName == "svg" && values["xmlns"] == "http://www.w3.org/2000/svg" }
        depth += 1
        if depth > 4 || !tags.contains(elementName) || !Set(values.keys).isSubset(of: attributes) || (values["xmlns"] != nil && values["xmlns"] != "http://www.w3.org/2000/svg") {
            valid = false; parser.abortParsing()
        }
        for (key, value) in values where key != "xmlns" {
            let fixed: [String: String] = ["font-family": "system-ui, sans-serif", "stroke-linecap": "round", "stroke-linejoin": "round", "dominant-baseline": "hanging"]
            let safe: Bool
            if key == "dy" { safe = value == "0" || value == "1.25em" }
            else if let expected = fixed[key] { safe = value == expected }
            else if ["fill", "stroke"].contains(key) { safe = value == "none" || value.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil }
            else { safe = value.range(of: "^[0-9., eE+%\\-]+$", options: .regularExpression) != nil }
            if !safe { valid = false; parser.abortParsing() }
        }
    }
    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) { depth -= 1 }
}

private func validatedWhiteboardExport(_ body: Any?) throws -> (filename: String, data: Data) {
    guard let payload = body as? [String: Any], let filename = payload["filename"] as? String,
          !filename.isEmpty, filename.count <= 240, !filename.contains("/"), !filename.contains("\\"),
          !filename.contains("\0"), !filename.hasPrefix("."), filename.hasSuffix(".svg"),
          let svg = payload["svg"] as? String, let data = svg.data(using: .utf8), data.count <= 2 * 1024 * 1024,
          !svg.contains("<!"), !svg.contains("<?") else {
        throw StoreFailure(status: 400, message: "Exportación de pizarra inválida")
    }
    let validator = WhiteboardSVGValidator()
    let parser = XMLParser(data: data)
    parser.shouldResolveExternalEntities = false
    parser.delegate = validator
    guard parser.parse(), validator.valid, validator.rootIsSVG else {
        throw StoreFailure(status: 400, message: "El SVG debe contener solo geometría y texto")
    }
    return (filename, data)
}

final class NotesBridge: NSObject, WKScriptMessageHandler {
    private var store: PlainJotStore
    weak var webView: WKWebView?
    var chooseFolder: (() throws -> Bool)?

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

        if path == "/api/folder" {
            handleFolderRequest(id: id, method: method)
            return
        }

        if path == "/api/export/whiteboard" {
            handleWhiteboardExport(id: id, method: method, body: requestBody)
            return
        }

        do {
            let response = try store.route(method: method, path: path, body: requestBody)
            resolve(id: id, status: response.status, body: response.body)
        } catch let failure as StoreFailure {
            resolve(id: id, status: failure.status, body: ["error": failure.message])
        } catch {
            resolve(id: id, status: 500, body: ["error": "No se pudo acceder a la carpeta PlainJot"])
        }
    }

    func replaceStore(_ store: PlainJotStore) {
        self.store = store
    }

    private func handleWhiteboardExport(id: String, method: String, body: Any?) {
        guard method == "POST" else {
            resolve(id: id, status: 405, body: ["error": "Método no permitido"]); return
        }
        do {
            let export = try validatedWhiteboardExport(body)
            let panel = NSSavePanel()
            panel.title = "Exportar pizarra"
            panel.nameFieldStringValue = export.filename
            panel.allowedContentTypes = [.svg]
            panel.begin { [weak self] response in
                guard let self else { return }
                guard response == .OK, let url = panel.url else {
                    self.resolve(id: id, status: 200, body: ["saved": false]); return
                }
                guard url.pathExtension.lowercased() == "svg" else {
                    self.resolve(id: id, status: 400, body: ["error": "El archivo de exportación debe ser SVG"]); return
                }
                do {
                    try export.data.write(to: url, options: .atomic)
                    self.resolve(id: id, status: 200, body: ["saved": true])
                } catch {
                    self.resolve(id: id, status: 500, body: ["error": "No se pudo exportar la pizarra"])
                }
            }
        } catch let failure as StoreFailure {
            resolve(id: id, status: failure.status, body: ["error": failure.message])
        } catch {
            resolve(id: id, status: 500, body: ["error": "No se pudo exportar la pizarra"])
        }
    }

    private func handleFolderRequest(id: String, method: String) {
        if method == "GET" {
            resolve(id: id, status: 200, body: folderInfo(changed: false))
            return
        }
        guard method == "POST" else {
            resolve(id: id, status: 405, body: ["error": "Método no permitido"])
            return
        }
        guard let chooseFolder else {
            resolve(id: id, status: 501, body: ["error": "El selector de carpetas no está disponible"])
            return
        }
        do {
            resolve(id: id, status: 200, body: folderInfo(changed: try chooseFolder()))
        } catch let failure as StoreFailure {
            resolve(id: id, status: failure.status, body: ["error": failure.message])
        } catch {
            resolve(id: id, status: 500, body: ["error": "No se pudo cambiar la carpeta"])
        }
    }

    private func folderInfo(changed: Bool) -> [String: Any] {
        let path = store.directoryURL.path
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let displayPath = path == home
            ? "~"
            : path.hasPrefix(home + "/") ? "~" + String(path.dropFirst(home.count)) : path
        return [
            "path": path,
            "display_path": displayPath,
            "can_choose": true,
            "deletion_mode": "trash",
            "changed": changed,
        ]
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
    var didFinishNavigation: ((WKWebView) -> Void)?

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

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) {
        didFinishNavigation?(webView)
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
    private var store: PlainJotStore?
    private var directoryWatcher: DirectoryWatcher?
    private var pendingOpenPaths: [String] = []
    private var pendingDocumentID: String?
    private var webInterfaceReady = false
    private let navigationDelegate = NavigationDelegate()
    private let javaScriptDialogDelegate = JavaScriptDialogDelegate()
    private let configuration = PlainJotConfiguration(fileURL: PlainJotConfiguration.defaultFileURL)

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

    func application(_ sender: NSApplication, openFiles filenames: [String]) {
        guard store != nil else {
            pendingOpenPaths.append(contentsOf: filenames)
            sender.reply(toOpenOrPrint: .success)
            return
        }

        let accepted = queueFirstDocument(from: filenames)
        sender.reply(toOpenOrPrint: accepted ? .success : .failure)
    }

    @objc private func createNewNote(_ sender: Any?) {
        webView?.evaluateJavaScript("createForCurrentSection();")
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
        let newNote = NSMenuItem(title: "Crear…", action: #selector(createNewNote(_:)), keyEquivalent: "n")
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
        self.store = store

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
        notesBridge.chooseFolder = { [weak self] in
            guard let self else {
                throw StoreFailure(status: 500, message: "PlainJot ya no está disponible")
            }
            return try self.chooseNotesDirectory()
        }
        controller.add(notesBridge, name: "notes")

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller
        configuration.websiteDataStore = .default()

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = navigationDelegate
        webView.uiDelegate = javaScriptDialogDelegate
        notesBridge.webView = webView
        navigationDelegate.didFinishNavigation = { [weak self] _ in
            self?.webInterfaceReady = true
            self?.presentPendingDocument()
        }
        webView.loadFileURL(indexURL, allowingReadAccessTo: webDirectory)

        let watcher = try startDirectoryWatcher(for: store, webView: webView)

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

        if !pendingOpenPaths.isEmpty {
            let paths = pendingOpenPaths
            pendingOpenPaths.removeAll()
            _ = queueFirstDocument(from: paths)
        }
    }

    private func chooseNotesDirectory() throws -> Bool {
        guard let store, let webView else {
            throw StoreFailure(status: 500, message: "PlainJot todavía no está listo")
        }

        let panel = NSOpenPanel()
        panel.title = "Seleccionar carpeta de PlainJot"
        panel.message = "PlainJot leerá y guardará aquí sus archivos Markdown."
        panel.prompt = "Usar carpeta"
        panel.directoryURL = store.directoryURL
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false

        guard panel.runModal() == .OK, let selectedURL = panel.url else { return false }
        let newStore = try PlainJotStore(directoryURL: selectedURL)
        guard newStore.directoryURL != store.directoryURL else { return false }

        let newWatcher = try startDirectoryWatcher(for: newStore, webView: webView)
        do {
            try configuration.saveNotesDirectory(newStore.directoryURL)
        } catch {
            newWatcher.stop()
            throw error
        }

        directoryWatcher?.stop()
        bridge?.replaceStore(newStore)
        self.store = newStore
        directoryWatcher = newWatcher
        return true
    }

    private func startDirectoryWatcher(for store: PlainJotStore, webView: WKWebView) throws -> DirectoryWatcher {
        let watcher = DirectoryWatcher(directoryURL: store.directoryURL) { [weak webView] in
            DispatchQueue.main.async {
                webView?.evaluateJavaScript("window.__plainjotFilesChanged?.();")
            }
        }
        try watcher.start()
        return watcher
    }

    @discardableResult
    private func queueFirstDocument(from paths: [String]) -> Bool {
        guard let store else { return false }
        for path in paths {
            guard let documentID = try? store.documentID(forOpenedFileURL: URL(fileURLWithPath: path)) else {
                continue
            }
            pendingDocumentID = documentID
            window?.makeKeyAndOrderFront(nil)
            NSApplication.shared.activate(ignoringOtherApps: true)
            presentPendingDocument()
            return true
        }
        return false
    }

    private func presentPendingDocument() {
        guard webInterfaceReady, let documentID = pendingDocumentID, let webView else { return }
        guard
            let data = try? JSONSerialization.data(withJSONObject: [documentID]),
            let json = String(data: data, encoding: .utf8)
        else { return }
        pendingDocumentID = nil
        webView.evaluateJavaScript("window.__plainjotOpenDocument?.(\(json)[0]);")
    }

    private func preferredNotesDirectory() -> URL {
        if let configured = configuration.loadNotesDirectory() {
            return configured
        }
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

    let configuredDirectory = testDirectory.appendingPathComponent("configured", isDirectory: true)
    try FileManager.default.createDirectory(at: configuredDirectory, withIntermediateDirectories: true)
    let testConfiguration = PlainJotConfiguration(
        fileURL: testDirectory.appendingPathComponent("config.json", isDirectory: false)
    )
    try testConfiguration.saveNotesDirectory(configuredDirectory)
    try require(
        testConfiguration.loadNotesDirectory() == configuredDirectory.resolvingSymlinksInPath(),
        "No se conservó la carpeta seleccionada"
    )

    var discardedDocumentURL: URL?
    let store = try PlainJotStore(directoryURL: testDirectory) { fileURL in
        discardedDocumentURL = fileURL
        try FileManager.default.removeItem(at: fileURL)
    }
    let created = try store.route(
        method: "POST",
        path: "/api/notes",
        body: ["title": "Prueba nativa", "body": "Contenido local"]
    )
    guard let note = created.body as? [String: Any], let noteID = note["id"] as? String else {
        throw StoreFailure(status: 500, message: "Falló la creación nativa")
    }
    try require(created.status == 201, "Estado incorrecto al crear una nota")
    let drawingBody = "```plainjot-whiteboard\n{\"version\":1,\"width\":1600,\"height\":1000,\"elements\":[]}\n```"
    let drawing = try store.createNote(title: "Architecture", body: drawingBody, kind: "whiteboard", project: "plainjot")
    let drawingID = drawing["id"] as? String ?? ""
    try require(drawing["kind"] as? String == "whiteboard" && drawing["body"] as? String == drawingBody, "Se perdió la pizarra Markdown")
    let drawingURL = testDirectory.appendingPathComponent(drawingID)
    try String(contentsOf: drawingURL, encoding: .utf8).replacingOccurrences(of: "# Architecture", with: "# External architecture").write(to: drawingURL, atomically: true, encoding: .utf8)
    try requireStoreFailure(status: 409) {
        _ = try store.updateDocument(drawingID, title: "Stale", body: drawingBody, expectedRevision: drawing["revision"] as? String)
    }
    let externalDrawing = try store.getDocument(drawingID)
    try require(externalDrawing["title"] as? String == "External architecture", "No se detectó la pizarra externa")
    let safeSVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1600\" height=\"1000\"><title>Board &amp; journal</title><rect width=\"100%\" height=\"100%\" fill=\"#faf9f5\"/><text x=\"10\" y=\"10\" fill=\"#30343b\" font-family=\"system-ui, sans-serif\" font-size=\"26\" dominant-baseline=\"hanging\"><tspan x=\"10\" dy=\"0\">API</tspan></text></svg>"
    _ = try validatedWhiteboardExport(["filename": "architecture.svg", "svg": safeSVG])
    _ = try validatedWhiteboardExport(["filename": "multiline.svg", "svg": safeSVG.replacingOccurrences(of: "</tspan>", with: "</tspan><tspan x=\"10\" dy=\"1.25em\">Auth</tspan>")])
    for unsafe in ["<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>", safeSVG.replacingOccurrences(of: "fill=\"#faf9f5\"", with: "fill=\"url(file:///etc/passwd)\""), safeSVG.replacingOccurrences(of: "<rect", with: "<rect onload=\"evil\""), "<!DOCTYPE svg>" + safeSVG] {
        try requireStoreFailure(status: 400) { _ = try validatedWhiteboardExport(["filename": "board.svg", "svg": unsafe]) }
    }
    try requireStoreFailure(status: 400) { _ = try validatedWhiteboardExport(["filename": "../board.svg", "svg": safeSVG]) }
    try requireStoreFailure(status: 400) { _ = try store.updateDocument(drawingID, title: "Converted", body: "", kind: "analysis") }
    try store.deleteDocument(drawingID)
    discardedDocumentURL = nil
    let templatesResult = try store.route(method: "GET", path: "/api/templates", body: nil)
    let analysis = try store.createNote(title: "Login analysis", body: "## Hallazgos\n\nEvidence", kind: "analysis", project: "alpha", source: "codex")
    let analysisID = analysis["id"] as? String ?? ""
    try require(analysis["kind"] as? String == "analysis", "Falló la creación del análisis")
    let ordinary = try store.updateDocument(analysisID, title: "Login analysis", body: "## Hallazgos\n\nEvidence", expectedRevision: analysis["revision"] as? String, kind: "")
    try require(ordinary["kind"] as? String == "" && ordinary["source"] as? String == "codex", "Se perdieron los metadatos al cambiar de tipo")
    let classified = try store.route(method: "PUT", path: "/api/documents/\(analysisID)", body: ["title": "Login analysis", "body": "## Hallazgos\n\nEvidence", "kind": "analysis", "expected_revision": ordinary["revision"] as? String ?? ""])
    try require((classified.body as? [String: Any])?["kind"] as? String == "analysis", "Falló la clasificación del análisis")
    try requireStoreFailure(status: 409) { _ = try store.updateDocument(analysisID, title: "Old", body: "", expectedRevision: "stale", kind: "") }
    for invalid in ["whiteboard", "task", "analysis\ntype: task"] {
        try requireStoreFailure(status: 400) { _ = try store.updateDocument(analysisID, title: "Changed", body: "", kind: invalid) }
    }
    try requireStoreFailure(status: 400) { _ = try store.route(method: "PUT", path: "/api/documents/\(analysisID)", body: ["title": "Changed", "kind": 42]) }
    let keptAnalysis = try store.getDocument(analysisID)
    try require(keptAnalysis["body"] as? String == "## Hallazgos\n\nEvidence", "Se modificó el análisis tras un cambio inválido")
    let idea = try store.createNote(title: "Offline idea", body: "Proposal", kind: "idea", project: "alpha", parent: analysisID)
    let ideaID = idea["id"] as? String ?? ""
    let relatedTask = try store.createTask(title: "Prototype offline", body: "", project: "alpha", parent: ideaID)
    let relatedTaskID = relatedTask["id"] as? String ?? ""
    try require(idea["parent"] as? String == analysisID && relatedTask["parent"] as? String == ideaID, "Se perdieron relaciones del mapa")
    try requireStoreFailure(status: 400) { _ = try store.updateDocument(analysisID, title: "Login analysis", body: "Evidence", parent: relatedTaskID) }
    for invalidParent in [analysisID, "../outside.md", "/tmp/outside.md"] {
        try requireStoreFailure(status: 400) { _ = try store.updateDocument(analysisID, title: "Login analysis", body: "Evidence", parent: invalidParent) }
    }
    let missingParent = try store.updateDocument(ideaID, title: "Offline idea", body: "Proposal", parent: "future-note.md")
    try require(missingParent["parent"] as? String == "future-note.md", "No se conservó una referencia externa pendiente")
    try requireStoreFailure(status: 400) { _ = try store.route(method: "PUT", path: "/api/documents/\(ideaID)", body: ["title": "Idea", "parent": 42]) }
    guard let templates = templatesResult.body as? [[String: Any]] else {
        throw StoreFailure(status: 500, message: "No se pudo cargar el catálogo de plantillas")
    }
    try require(templates.count == 9, "Faltan plantillas de desarrollo")
    for template in templates where template["type"] as? String == "note" {
        let kind = template["id"] as? String ?? ""
        let developerNote = try store.createNote(title: "Template", body: template["body"] as? String ?? "", kind: kind, project: "alpha", source: "codex")
        try require(developerNote["project"] as? String == "alpha" && developerNote["source"] as? String == "codex", "Se perdieron metadatos compartidos")
    }
    let projectNote = try store.updateDocument(noteID, title: "Prueba nativa", body: "Contenido local", expectedRevision: note["revision"] as? String, project: "My project: one")
    try require(projectNote["project"] as? String == "My project: one", "Falló la edición de proyecto")
    try requireStoreFailure(status: 409) {
        _ = try store.updateDocument(noteID, title: "Old", body: "", expectedRevision: "stale", project: "beta")
    }
    try requireStoreFailure(status: 400) {
        _ = try store.route(method: "PUT", path: "/api/documents/\(noteID)", body: ["title": "Invalid", "body": "", "project": 42])
    }
    try requireStoreFailure(status: 400) {
        _ = try store.createNote(title: "Invalid", body: "", project: "alpha\ntype: task")
    }
    let metadataURL = testDirectory.appendingPathComponent("metadata-note.md")
    try "---\ntype: note\n# Keep comment\ncustom: preserve\nproject: old\n---\n\n# Metadata\n\nBody\n".write(to: metadataURL, atomically: true, encoding: .utf8)
    let metadataNote = try store.updateDocument("metadata-note.md", title: "Metadata", body: "Body", project: "new \"project\"")
    let metadataContent = try String(contentsOf: metadataURL, encoding: .utf8)
    try require(metadataNote["project"] as? String == "new \"project\"", "Falló el quoting de proyecto")
    try require(metadataContent.contains("# Keep comment\ncustom: preserve"), "Se perdió frontmatter externo")
    let longMetadataURL = testDirectory.appendingPathComponent("long-metadata.md")
    let longMetadata = "---\ntype: note\n" + Array(repeating: "# Comment", count: 98).joined(separator: "\n") + "\n---\n\n# Long\n\nBody\n"
    try longMetadata.write(to: longMetadataURL, atomically: true, encoding: .utf8)
    try requireStoreFailure(status: 400) {
        _ = try store.updateDocument("long-metadata.md", title: "Long", body: "Body", project: "alpha")
    }
    let preservedLongMetadata = try String(contentsOf: longMetadataURL, encoding: .utf8)
    try requireStoreFailure(status: 400) { _ = try store.updateDocument("long-metadata.md", title: "Long", body: "Body", kind: "analysis") }
    try require(preservedLongMetadata == longMetadata, "Se modificó un frontmatter que excedería el límite")
    let journalResult = try store.route(
        method: "POST",
        path: "/api/notes",
        body: ["title": "Bug: Journal", "body": "## Síntoma\n\nNo abría.", "kind": "debug-journal"]
    )
    guard let journal = journalResult.body as? [String: Any], let journalID = journal["id"] as? String else {
        throw StoreFailure(status: 500, message: "Falló la creación del Debug Journal")
    }
    try require(journal["type"] as? String == "note" && journal["kind"] as? String == "debug-journal", "El journal no es una nota Markdown")
    let editedJournal = try store.updateDocument(journalID, title: "Bug: Resuelto", body: "## Qué aprendí\n\nComprobar el evento.")
    try require(editedJournal["kind"] as? String == "debug-journal", "Se perdió el tipo de journal al editar")
    let journalContent = try String(contentsOf: testDirectory.appendingPathComponent(journalID), encoding: .utf8)
    try require(journalContent.contains("kind: debug-journal") && journalContent.contains("created:"), "No se conservaron los metadatos Markdown")
    try requireStoreFailure(status: 400) {
        _ = try store.route(method: "POST", path: "/api/notes", body: ["title": "Invalid", "body": "", "kind": 42])
    }
    try requireStoreFailure(status: 400) {
        _ = try store.createNote(title: "Invalid", body: "", kind: "debug-journal\ntype: task")
    }
    let noteURL = testDirectory.appendingPathComponent(noteID)
    let openedDocumentID = try store.documentID(forOpenedFileURL: noteURL)
    try require(
        openedDocumentID == noteID,
        "No se aceptó un documento abierto desde PlainJot"
    )
    try requireStoreFailure(status: 400) {
        _ = try store.getDocument("../outside.md")
    }

    let outsideURL = testDirectory.deletingLastPathComponent()
        .appendingPathComponent("plainjot-outside-\(UUID().uuidString).md")
    let linkedURL = testDirectory.appendingPathComponent("linked.md")
    try "# Outside\n".write(to: outsideURL, atomically: true, encoding: .utf8)
    defer { try? FileManager.default.removeItem(at: outsideURL) }
    try requireStoreFailure(status: 400) {
        _ = try store.documentID(forOpenedFileURL: outsideURL)
    }
    try FileManager.default.createSymbolicLink(at: linkedURL, withDestinationURL: outsideURL)
    try requireStoreFailure(status: 400) {
        _ = try store.documentID(forOpenedFileURL: linkedURL)
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
    try requireStoreFailure(status: 409) {
        try store.deleteDocument(conflictID, expectedRevision: revision)
    }
    try require(discardedDocumentURL == nil, "Se descartó un documento con cambios externos")

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
    try require(tasks.contains { $0["id"] as? String == "external-task.md" }, "No se detectó la tarea externa")

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
    try require(discardedDocumentURL?.lastPathComponent == noteID, "El documento no se envió al descarte seguro")
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

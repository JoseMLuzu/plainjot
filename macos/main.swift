@preconcurrency import AppKit
@preconcurrency import WebKit
import Foundation
import Darwin

struct StoreFailure: LocalizedError {
    let status: Int
    let message: String

    var errorDescription: String? { message }
}

final class NotesStore {
    let directoryURL: URL
    private let fileManager = FileManager.default
    private let dateFormatter: ISO8601DateFormatter

    init(directoryURL: URL) throws {
        self.directoryURL = directoryURL.standardizedFileURL
        self.dateFormatter = ISO8601DateFormatter()
        self.dateFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        try fileManager.createDirectory(at: self.directoryURL, withIntermediateDirectories: true)
    }

    func route(method: String, path: String, body: Any?) throws -> (status: Int, body: Any?) {
        if method == "GET" && path == "/api/notes" {
            return (200, try listNotes())
        }
        if method == "POST" && path == "/api/notes" {
            let fields = try noteFields(from: body)
            return (201, try createNote(title: fields.title, body: fields.body))
        }

        let prefix = "/api/notes/"
        guard path.hasPrefix(prefix) else {
            throw StoreFailure(status: 404, message: "Ruta no encontrada")
        }
        let encodedID = String(path.dropFirst(prefix.count))
        guard let noteID = encodedID.removingPercentEncoding else {
            throw StoreFailure(status: 400, message: "Nombre de nota no válido")
        }

        switch method {
        case "GET":
            return (200, try getNote(noteID))
        case "PUT":
            let fields = try noteFields(from: body)
            return (200, try updateNote(noteID, title: fields.title, body: fields.body))
        case "DELETE":
            try deleteNote(noteID)
            return (204, nil)
        default:
            throw StoreFailure(status: 405, message: "Método no permitido")
        }
    }

    func listNotes() throws -> [[String: Any]] {
        let keys: [URLResourceKey] = [.isRegularFileKey, .contentModificationDateKey]
        let files = try fileManager.contentsOfDirectory(
            at: directoryURL,
            includingPropertiesForKeys: keys,
            options: [.skipsHiddenFiles]
        )

        var notes: [[String: Any]] = []
        for fileURL in files where fileURL.pathExtension.lowercased() == "md" {
            guard isValidNoteID(fileURL.lastPathComponent) else { continue }
            let values = try fileURL.resourceValues(forKeys: Set(keys))
            guard values.isRegularFile == true else { continue }
            guard let content = try? String(contentsOf: fileURL, encoding: .utf8) else { continue }
            let parts = splitMarkdown(fileURL: fileURL, content: content)
            let preview = parts.body
                .replacingOccurrences(of: "#", with: "")
                .components(separatedBy: .whitespacesAndNewlines)
                .filter { !$0.isEmpty }
                .joined(separator: " ")

            let modified = values.contentModificationDate ?? Date.distantPast
            notes.append([
                "id": fileURL.lastPathComponent,
                "title": parts.title,
                "preview": String(preview.prefix(140)),
                "modified": dateFormatter.string(from: modified),
            ])
        }

        return notes.sorted {
            guard let left = $0["modified"] as? String, let right = $1["modified"] as? String else {
                return false
            }
            return left > right
        }
    }

    func getNote(_ noteID: String) throws -> [String: Any] {
        let fileURL = try fileURL(for: noteID)
        guard fileManager.fileExists(atPath: fileURL.path) else {
            throw StoreFailure(status: 404, message: "La nota no existe")
        }
        let content = try String(contentsOf: fileURL, encoding: .utf8)
        let parts = splitMarkdown(fileURL: fileURL, content: content)
        return ["id": noteID, "title": parts.title, "body": parts.body]
    }

    func createNote(title: String, body: String) throws -> [String: Any] {
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "Sin título"
            : title.trimmingCharacters(in: .whitespacesAndNewlines)
        let noteID = "\(slugify(cleanTitle))-\(UUID().uuidString.lowercased().prefix(7)).md"
        let fileURL = try fileURL(for: noteID)
        try renderMarkdown(title: cleanTitle, body: body).write(to: fileURL, atomically: true, encoding: .utf8)
        return try getNote(noteID)
    }

    func updateNote(_ noteID: String, title: String, body: String) throws -> [String: Any] {
        let fileURL = try fileURL(for: noteID)
        guard fileManager.fileExists(atPath: fileURL.path) else {
            throw StoreFailure(status: 404, message: "La nota no existe")
        }
        try renderMarkdown(title: title, body: body).write(to: fileURL, atomically: true, encoding: .utf8)
        return try getNote(noteID)
    }

    func deleteNote(_ noteID: String) throws {
        let fileURL = try fileURL(for: noteID)
        guard fileManager.fileExists(atPath: fileURL.path) else {
            throw StoreFailure(status: 404, message: "La nota no existe")
        }
        try fileManager.removeItem(at: fileURL)
    }

    private func noteFields(from value: Any?) throws -> (title: String, body: String) {
        guard
            let payload = value as? [String: Any],
            let title = payload["title"] as? String,
            let body = payload["body"] as? String
        else {
            throw StoreFailure(status: 400, message: "Título y contenido deben ser texto")
        }
        guard title.count <= 200 else {
            throw StoreFailure(status: 400, message: "El título es demasiado largo")
        }
        return (title, body)
    }

    private func fileURL(for noteID: String) throws -> URL {
        guard isValidNoteID(noteID) else {
            throw StoreFailure(status: 400, message: "Nombre de nota no válido")
        }
        let candidate = directoryURL.appendingPathComponent(noteID, isDirectory: false).standardizedFileURL
        guard candidate.deletingLastPathComponent() == directoryURL else {
            throw StoreFailure(status: 400, message: "Ruta de nota no válida")
        }
        return candidate
    }

    private func isValidNoteID(_ noteID: String) -> Bool {
        noteID.range(of: "^[A-Za-z0-9][A-Za-z0-9._-]*\\.md$", options: .regularExpression) != nil
    }

    private func splitMarkdown(fileURL: URL, content: String) -> (title: String, body: String) {
        var lines = content.components(separatedBy: .newlines)
        while lines.last == "" { lines.removeLast() }

        if let first = lines.first, first.hasPrefix("# ") {
            let title = String(first.dropFirst(2)).trimmingCharacters(in: .whitespacesAndNewlines)
            lines.removeFirst()
            if lines.first == "" { lines.removeFirst() }
            return (title.isEmpty ? fileURL.deletingPathExtension().lastPathComponent : title, lines.joined(separator: "\n"))
        }

        let fallback = fileURL.deletingPathExtension().lastPathComponent
            .replacingOccurrences(of: "-", with: " ")
            .capitalized
        return (fallback, lines.joined(separator: "\n"))
    }

    private func renderMarkdown(title: String, body: String) -> String {
        let titleWords = title
            .replacingOccurrences(of: "\r", with: " ")
            .replacingOccurrences(of: "\n", with: " ")
            .components(separatedBy: .whitespaces)
            .filter { !$0.isEmpty }
        let safeTitle = titleWords.isEmpty ? "Sin título" : titleWords.joined(separator: " ")
        let cleanBody = body
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .trimmingCharacters(in: .newlines)
        return "# \(safeTitle)\n\n\(cleanBody)\n"
    }

    private func slugify(_ value: String) -> String {
        let folded = value
            .folding(options: [.diacriticInsensitive, .widthInsensitive], locale: Locale(identifier: "es"))
            .lowercased()
        let slug = folded
            .replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return String((slug.isEmpty ? "nota" : slug).prefix(60))
    }
}

final class NotesBridge: NSObject, WKScriptMessageHandler {
    private let store: NotesStore
    weak var webView: WKWebView?

    init(store: NotesStore) {
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
            resolve(id: id, status: 500, body: ["error": "No se pudo acceder a las notas"])
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

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow?
    private var webView: WKWebView?
    private var bridge: NotesBridge?
    private let navigationDelegate = NavigationDelegate()

    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            try createApplicationMenu()
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

    @objc private func createNewNote(_ sender: Any?) {
        webView?.evaluateJavaScript("createNote();")
    }

    private func createApplicationMenu() throws {
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
        let newItem = NSMenuItem(title: "Nueva nota", action: #selector(createNewNote(_:)), keyEquivalent: "n")
        newItem.target = self
        fileMenu.addItem(newItem)
        fileItem.submenu = fileMenu
        mainMenu.addItem(fileItem)

        NSApplication.shared.mainMenu = mainMenu
    }

    private func createWindow() throws {
        let notesDirectory = preferredNotesDirectory()
        let store = try NotesStore(directoryURL: notesDirectory)

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
        notesBridge.webView = webView
        webView.loadFileURL(indexURL, allowingReadAccessTo: webDirectory)

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

        self.bridge = notesBridge
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

func runSelfTest() throws {
    let testDirectory = FileManager.default.temporaryDirectory
        .appendingPathComponent("plainjot-self-test-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: testDirectory) }

    let store = try NotesStore(directoryURL: testDirectory)
    let created = try store.route(
        method: "POST",
        path: "/api/notes",
        body: ["title": "Prueba nativa", "body": "Contenido local"]
    )
    guard
        created.status == 201,
        let note = created.body as? [String: Any],
        let noteID = note["id"] as? String
    else {
        throw StoreFailure(status: 500, message: "Falló la creación nativa")
    }

    let listed = try store.route(method: "GET", path: "/api/notes", body: nil)
    guard let notes = listed.body as? [[String: Any]], notes.count == 1 else {
        throw StoreFailure(status: 500, message: "Falló el listado nativo")
    }

    let updated = try store.route(
        method: "PUT",
        path: "/api/notes/\(noteID)",
        body: ["title": "Prueba actualizada", "body": "Nuevo contenido"]
    )
    guard let updatedNote = updated.body as? [String: Any], updatedNote["title"] as? String == "Prueba actualizada" else {
        throw StoreFailure(status: 500, message: "Falló la edición nativa")
    }

    _ = try store.route(method: "DELETE", path: "/api/notes/\(noteID)", body: nil)
    guard try store.listNotes().isEmpty else {
        throw StoreFailure(status: 500, message: "Falló el borrado nativo")
    }
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

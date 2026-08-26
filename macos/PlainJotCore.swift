import Foundation

struct StoreFailure: LocalizedError {
    let status: Int
    let message: String

    var errorDescription: String? { message }
}

private let taskStatuses: Set<String> = ["inbox", "todo", "done"]
private let taskFields = ["type", "status", "project", "source", "created", "completed"]
private let maximumFileBytes = 2 * 1024 * 1024

struct PlainJotConfiguration {
    let fileURL: URL

    static var defaultFileURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PlainJot", isDirectory: true)
            .appendingPathComponent("config.json", isDirectory: false)
    }

    func loadNotesDirectory() -> URL? {
        guard
            let data = try? Data(contentsOf: fileURL),
            let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let path = payload["notes_directory"] as? String,
            path.hasPrefix("/")
        else { return nil }

        let candidate = URL(fileURLWithPath: path, isDirectory: true)
            .standardizedFileURL
            .resolvingSymlinksInPath()
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: candidate.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            return nil
        }
        return candidate
    }

    func saveNotesDirectory(_ directoryURL: URL) throws {
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let payload = ["notes_directory": directoryURL.standardizedFileURL.resolvingSymlinksInPath().path]
        let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: fileURL, options: .atomic)
    }
}

private struct ParsedDocument {
    let id: String
    let title: String
    let body: String
    let metadata: [String: String]
    let frontmatterRaw: String?
    let modified: Date
    let revision: String

    var isTask: Bool { metadata["type"]?.lowercased() == "task" }
    var status: String { isTask ? metadata["status"] ?? "inbox" : "" }
}

final class PlainJotStore {
    let directoryURL: URL
    private let fileManager = FileManager.default
    private let dateFormatter: ISO8601DateFormatter
    private let discardFile: (URL) throws -> Void

    init(directoryURL: URL, discardFile: ((URL) throws -> Void)? = nil) throws {
        self.directoryURL = directoryURL.standardizedFileURL.resolvingSymlinksInPath()
        self.dateFormatter = ISO8601DateFormatter()
        self.discardFile = discardFile ?? { fileURL in
            try FileManager.default.trashItem(at: fileURL, resultingItemURL: nil)
        }
        self.dateFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        try fileManager.createDirectory(at: self.directoryURL, withIntermediateDirectories: true)
    }

    func route(method: String, path: String, body: Any?) throws -> (status: Int, body: Any?) {
        if method == "GET" && path == "/api/notes" {
            return (200, try listNotes())
        }
        if method == "GET" && path == "/api/tasks" {
            return (200, try listTasks())
        }
        if method == "POST" && path == "/api/notes" {
            let fields = try documentFields(from: body)
            return (201, try createNote(title: fields.title, body: fields.body))
        }
        if method == "POST" && path == "/api/tasks" {
            let fields = try documentFields(from: body)
            let payload = body as? [String: Any] ?? [:]
            return (
                201,
                try createTask(
                    title: fields.title,
                    body: fields.body,
                    status: payload["status"] as? String ?? "inbox",
                    project: payload["project"] as? String ?? "",
                    source: payload["source"] as? String ?? ""
                )
            )
        }

        if let documentID = decodedID(path: path, prefix: "/api/documents/")
            ?? decodedID(path: path, prefix: "/api/notes/")
        {
            switch method {
            case "GET":
                return (200, try getDocument(documentID))
            case "PUT":
                let fields = try documentFields(from: body)
                let expected = (body as? [String: Any])?["expected_revision"] as? String
                return (
                    200,
                    try updateDocument(
                        documentID,
                        title: fields.title,
                        body: fields.body,
                        expectedRevision: expected
                    )
                )
            case "DELETE":
                let expected = (body as? [String: Any])?["expected_revision"] as? String
                try deleteDocument(documentID, expectedRevision: expected)
                return (204, nil)
            default:
                throw StoreFailure(status: 405, message: "Método no permitido")
            }
        }

        if let taskID = decodedID(path: path, prefix: "/api/tasks/"), method == "PATCH" {
            guard
                let payload = body as? [String: Any],
                let status = payload["status"] as? String
            else {
                throw StoreFailure(status: 400, message: "El estado debe ser texto")
            }
            let expected = payload["expected_revision"] as? String
            return (200, try updateTaskStatus(taskID, status: status, expectedRevision: expected))
        }

        throw StoreFailure(status: 404, message: "Ruta no encontrada")
    }

    func listNotes() throws -> [[String: Any]] {
        try listDocuments().filter { $0["type"] as? String == "note" }
    }

    func listTasks() throws -> [[String: Any]] {
        try listDocuments().filter { $0["type"] as? String == "task" }
    }

    func listDocuments() throws -> [[String: Any]] {
        let keys: Set<URLResourceKey> = [
            .isRegularFileKey,
            .isSymbolicLinkKey,
            .contentModificationDateKey,
            .fileSizeKey,
        ]
        let files = try fileManager.contentsOfDirectory(
            at: directoryURL,
            includingPropertiesForKeys: Array(keys),
            options: [.skipsHiddenFiles]
        )

        var documents: [[String: Any]] = []
        for fileURL in files where fileURL.pathExtension.lowercased() == "md" {
            guard isValidDocumentID(fileURL.lastPathComponent) else { continue }
            guard let values = try? fileURL.resourceValues(forKeys: keys) else { continue }
            guard values.isRegularFile == true, values.isSymbolicLink != true else { continue }
            guard let document = try? readDocument(fileURL) else { continue }
            documents.append(summary(document))
        }
        return documents.sorted {
            guard let left = $0["modified"] as? String, let right = $1["modified"] as? String else {
                return false
            }
            return left > right
        }
    }

    func getDocument(_ documentID: String) throws -> [String: Any] {
        try dictionary(readDocument(try fileURL(for: documentID)))
    }

    func documentID(forOpenedFileURL fileURL: URL) throws -> String {
        let candidate = fileURL.standardizedFileURL
        guard isValidDocumentID(candidate.lastPathComponent) else {
            throw StoreFailure(status: 400, message: "Nombre de documento no válido")
        }
        return try secureExistingURL(candidate).lastPathComponent
    }

    func createNote(title: String, body: String) throws -> [String: Any] {
        let cleanTitle = try cleanTitle(title)
        let documentID = "\(slugify(cleanTitle))-\(UUID().uuidString.lowercased().prefix(7)).md"
        let fileURL = try fileURL(for: documentID)
        try atomicWrite(renderMarkdown(title: cleanTitle, body: body), to: fileURL)
        return try getDocument(documentID)
    }

    func createTask(
        title: String,
        body: String,
        status: String = "inbox",
        project: String = "",
        source: String = ""
    ) throws -> [String: Any] {
        let cleanTitle = try cleanTitle(title)
        let normalizedStatus = status.lowercased()
        guard taskStatuses.contains(normalizedStatus) else {
            throw StoreFailure(status: 400, message: "Estado de tarea no compatible")
        }
        let metadata = [
            "type": "task",
            "status": normalizedStatus,
            "project": try metadataValue(project, field: "project"),
            "source": try metadataValue(source, field: "source"),
            "created": timestamp(),
            "completed": "",
        ]
        let documentID = "\(slugify(cleanTitle))-\(UUID().uuidString.lowercased().prefix(7)).md"
        let fileURL = try fileURL(for: documentID)
        try atomicWrite(try renderTask(title: cleanTitle, body: body, metadata: metadata), to: fileURL)
        return try getDocument(documentID)
    }

    func updateDocument(
        _ documentID: String,
        title: String,
        body: String,
        expectedRevision: String? = nil
    ) throws -> [String: Any] {
        let fileURL = try fileURL(for: documentID)
        let existing = try readDocument(fileURL)
        try checkRevision(existing, expected: expectedRevision)
        let markdown = try renderMarkdown(title: title, body: body)
        let content = existing.frontmatterRaw.map { "---\n\($0)\n---\n\n\(markdown)" } ?? markdown
        try atomicWrite(content, to: fileURL)
        return try getDocument(documentID)
    }

    func updateTaskStatus(
        _ documentID: String,
        status: String,
        expectedRevision: String? = nil
    ) throws -> [String: Any] {
        let normalizedStatus = status.lowercased()
        guard taskStatuses.contains(normalizedStatus) else {
            throw StoreFailure(status: 400, message: "Estado de tarea no compatible")
        }
        let fileURL = try fileURL(for: documentID)
        let existing = try readDocument(fileURL)
        guard existing.isTask else {
            throw StoreFailure(status: 400, message: "El documento no es una tarea")
        }
        try checkRevision(existing, expected: expectedRevision)
        var metadata = existing.metadata
        metadata["status"] = normalizedStatus
        metadata["completed"] = normalizedStatus == "done" ? timestamp() : ""
        let content = try renderTask(title: existing.title, body: existing.body, metadata: metadata)
        try atomicWrite(content, to: fileURL)
        return try getDocument(documentID)
    }

    func deleteDocument(_ documentID: String, expectedRevision: String? = nil) throws {
        let fileURL = try fileURL(for: documentID)
        let existing = try readDocument(fileURL)
        try checkRevision(existing, expected: expectedRevision)
        try discardFile(fileURL)
    }

    private func readDocument(_ fileURL: URL) throws -> ParsedDocument {
        let safeURL = try secureExistingURL(fileURL)
        let values = try safeURL.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
        let size = values.fileSize ?? 0
        guard size <= maximumFileBytes else {
            throw StoreFailure(status: 400, message: "El documento es demasiado grande")
        }
        let content = try String(contentsOf: safeURL, encoding: .utf8)
        let parts = parseMarkdown(fileURL: safeURL, content: content)
        if parts.metadata["type"]?.lowercased() == "task" {
            let status = parts.metadata["status"]?.lowercased() ?? "inbox"
            guard taskStatuses.contains(status) else {
                throw StoreFailure(status: 400, message: "Estado de tarea no compatible")
            }
        }
        let modified = values.contentModificationDate ?? Date.distantPast
        return ParsedDocument(
            id: safeURL.lastPathComponent,
            title: parts.title,
            body: parts.body,
            metadata: parts.metadata,
            frontmatterRaw: parts.raw,
            modified: modified,
            revision: "\(Int64(modified.timeIntervalSince1970 * 1_000_000)):\(size)"
        )
    }

    private func dictionary(_ document: ParsedDocument) -> [String: Any] {
        var result: [String: Any] = [
            "id": document.id,
            "title": document.title,
            "body": document.body,
            "type": document.isTask ? "task" : "note",
            "modified": dateFormatter.string(from: document.modified),
            "revision": document.revision,
        ]
        for key in taskFields.dropFirst() {
            result[key] = document.isTask ? (key == "status" ? document.status : document.metadata[key] ?? "") : ""
        }
        return result
    }

    private func summary(_ document: ParsedDocument) -> [String: Any] {
        var result = dictionary(document)
        result.removeValue(forKey: "body")
        let preview = document.body
            .replacingOccurrences(of: "#", with: "")
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        result["preview"] = String(preview.prefix(140))
        return result
    }

    private func parseMarkdown(
        fileURL: URL,
        content: String
    ) -> (title: String, body: String, metadata: [String: String], raw: String?) {
        let normalized = content
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        let frontmatter = parseFrontmatter(normalized)
        var lines = frontmatter.markdown.components(separatedBy: "\n")
        while lines.last == "" { lines.removeLast() }

        if let first = lines.first, first.hasPrefix("# ") {
            let parsedTitle = String(first.dropFirst(2)).trimmingCharacters(in: .whitespacesAndNewlines)
            lines.removeFirst()
            if lines.first == "" { lines.removeFirst() }
            let title = parsedTitle.isEmpty ? fileURL.deletingPathExtension().lastPathComponent : parsedTitle
            return (String(title.prefix(200)), lines.joined(separator: "\n"), frontmatter.metadata, frontmatter.raw)
        }

        let fallback = fileURL.deletingPathExtension().lastPathComponent
            .replacingOccurrences(of: "-", with: " ")
            .capitalized
        return (String(fallback.prefix(200)), lines.joined(separator: "\n"), frontmatter.metadata, frontmatter.raw)
    }

    private func parseFrontmatter(_ content: String) -> (metadata: [String: String], raw: String?, markdown: String) {
        let lines = content.components(separatedBy: "\n")
        guard lines.first?.trimmingCharacters(in: .whitespaces) == "---" else {
            return ([:], nil, content)
        }
        let searchEnd = min(lines.count, 102)
        guard let closing = (1..<searchEnd).first(where: { lines[$0].trimmingCharacters(in: .whitespaces) == "---" }) else {
            return ([:], nil, content)
        }

        let rawLines = Array(lines[1..<closing])
        var metadata: [String: String] = [:]
        for line in rawLines {
            let stripped = line.trimmingCharacters(in: .whitespaces)
            if stripped.isEmpty || stripped.hasPrefix("#") { continue }
            guard let colon = line.firstIndex(of: ":") else { return ([:], nil, content) }
            let key = String(line[..<colon]).trimmingCharacters(in: .whitespaces)
            guard key.range(of: "^[A-Za-z][A-Za-z0-9_-]*$", options: .regularExpression) != nil else {
                return ([:], nil, content)
            }
            let value = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
            metadata[key] = parseScalar(value)
        }

        var remaining = Array(lines.dropFirst(closing + 1))
        if remaining.first == "" { remaining.removeFirst() }
        return (metadata, rawLines.joined(separator: "\n"), remaining.joined(separator: "\n"))
    }

    private func parseScalar(_ value: String) -> String {
        if value.count >= 2, value.hasPrefix("\""), value.hasSuffix("\"") {
            let wrapped = "[\(value)]"
            if
                let data = wrapped.data(using: .utf8),
                let array = try? JSONSerialization.jsonObject(with: data) as? [Any],
                let decoded = array.first as? String
            {
                return decoded
            }
        }
        if value.count >= 2, value.hasPrefix("'"), value.hasSuffix("'") {
            return String(value.dropFirst().dropLast()).replacingOccurrences(of: "''", with: "'")
        }
        return value
    }

    private func renderMarkdown(title: String, body: String) throws -> String {
        let safeTitle = try cleanTitle(title)
        let cleanBody = body
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .trimmingCharacters(in: .newlines)
        guard cleanBody.utf8.count <= maximumFileBytes else {
            throw StoreFailure(status: 400, message: "El documento es demasiado grande")
        }
        return "# \(safeTitle)\n\n\(cleanBody)\n"
    }

    private func renderTask(title: String, body: String, metadata: [String: String]) throws -> String {
        var values = metadata
        values["type"] = "task"
        let status = values["status"]?.lowercased() ?? "inbox"
        guard taskStatuses.contains(status) else {
            throw StoreFailure(status: 400, message: "Estado de tarea no compatible")
        }
        values["status"] = status
        for key in taskFields where values[key] == nil { values[key] = "" }
        let extraKeys = values.keys.filter { !taskFields.contains($0) }.sorted()
        let keys = taskFields + extraKeys
        let frontmatter = keys.map { "\($0): \(formatYAMLValue(values[$0] ?? ""))" }.joined(separator: "\n")
        return "---\n\(frontmatter)\n---\n\n\(try renderMarkdown(title: title, body: body))"
    }

    private func formatYAMLValue(_ value: String) -> String {
        if value.isEmpty { return "" }
        if value.range(of: "^[A-Za-z0-9][A-Za-z0-9._/@:+-]*$", options: .regularExpression) != nil {
            return value
        }
        guard
            let data = try? JSONSerialization.data(withJSONObject: [value]),
            let array = String(data: data, encoding: .utf8)
        else { return "\"\"" }
        return String(array.dropFirst().dropLast())
    }

    private func documentFields(from value: Any?) throws -> (title: String, body: String) {
        guard
            let payload = value as? [String: Any],
            let title = payload["title"] as? String,
            let body = payload["body"] as? String
        else {
            throw StoreFailure(status: 400, message: "Título y contenido deben ser texto")
        }
        return (title, body)
    }

    private func cleanTitle(_ title: String) throws -> String {
        let words = title
            .replacingOccurrences(of: "\r", with: " ")
            .replacingOccurrences(of: "\n", with: " ")
            .components(separatedBy: .whitespaces)
            .filter { !$0.isEmpty }
        let clean = words.isEmpty ? "Sin título" : words.joined(separator: " ")
        guard clean.count <= 200 else {
            throw StoreFailure(status: 400, message: "El título es demasiado largo")
        }
        return clean
    }

    private func metadataValue(_ value: String, field: String) throws -> String {
        guard !value.contains("\n"), !value.contains("\r"), value.count <= 200 else {
            throw StoreFailure(status: 400, message: "\(field) debe ser texto de una sola línea")
        }
        return value.trimmingCharacters(in: .whitespaces)
    }

    private func fileURL(for documentID: String) throws -> URL {
        guard isValidDocumentID(documentID) else {
            throw StoreFailure(status: 400, message: "Nombre de documento no válido")
        }
        let candidate = directoryURL.appendingPathComponent(documentID, isDirectory: false).standardizedFileURL
        guard candidate.deletingLastPathComponent().path == directoryURL.path else {
            throw StoreFailure(status: 400, message: "La ruta sale de la carpeta PlainJot")
        }
        if fileManager.fileExists(atPath: candidate.path) {
            _ = try secureExistingURL(candidate)
        }
        return candidate
    }

    private func secureExistingURL(_ fileURL: URL) throws -> URL {
        guard fileManager.fileExists(atPath: fileURL.path) else {
            throw StoreFailure(status: 404, message: "El documento no existe")
        }
        let values = try fileURL.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true else {
            throw StoreFailure(status: 400, message: "Los enlaces simbólicos no son compatibles")
        }
        let resolved = fileURL.resolvingSymlinksInPath().standardizedFileURL
        guard resolved.deletingLastPathComponent().path == directoryURL.path else {
            throw StoreFailure(status: 400, message: "La ruta sale de la carpeta PlainJot")
        }
        return resolved
    }

    private func isValidDocumentID(_ documentID: String) -> Bool {
        documentID.range(of: "^[A-Za-z0-9][A-Za-z0-9._-]*\\.md$", options: .regularExpression) != nil
    }

    private func decodedID(path: String, prefix: String) -> String? {
        guard path.hasPrefix(prefix) else { return nil }
        return String(path.dropFirst(prefix.count)).removingPercentEncoding
    }

    private func checkRevision(_ document: ParsedDocument, expected: String?) throws {
        if let expected, expected != document.revision {
            throw StoreFailure(status: 409, message: "El documento cambió fuera de PlainJot")
        }
    }

    private func slugify(_ value: String) -> String {
        let folded = value
            .folding(options: [.diacriticInsensitive, .widthInsensitive], locale: Locale(identifier: "en"))
            .lowercased()
        let slug = folded
            .replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return String((slug.isEmpty ? "note" : slug).prefix(60))
    }

    private func timestamp() -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: Date())
    }

    private func atomicWrite(_ content: String, to fileURL: URL) throws {
        try content.write(to: fileURL, atomically: true, encoding: .utf8)
        try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fileURL.path)
    }
}

import io
import json
import tempfile
import unittest
from pathlib import Path

from app import NotesStore, folder_info, make_handler, render_markdown, slugify, split_markdown


class NotesStoreTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.store = NotesStore(Path(self.temporary.name))

    def tearDown(self):
        self.temporary.cleanup()

    def request(self, method, path, payload=None):
        # Exercise the real HTTP handlers without binding a socket.
        handler_class = make_handler(self.store)
        handler = handler_class.__new__(handler_class)
        content = json.dumps(payload).encode() if payload is not None else b""
        handler.path = path
        handler.headers = {"Content-Length": str(len(content))}
        handler.rfile, handler.wfile = io.BytesIO(content), io.BytesIO()
        statuses = []
        handler.send_response = statuses.append
        handler.send_header = lambda *_: None
        handler.end_headers = lambda: None
        getattr(handler, f"do_{method}")()
        response = handler.wfile.getvalue()
        return statuses[0], json.loads(response) if response else None

    def test_template_api_and_shared_project_metadata(self):
        status, templates = self.request("GET", "/api/templates")
        self.assertEqual(status, 200)
        self.assertEqual(len(templates), 7)
        _, note = self.request("POST", "/api/notes", {"title": "Plan", "body": "Context", "kind": "roadmap", "project": "alpha", "source": "codex"})
        self.assertEqual(note["project"], "alpha")
        status, updated = self.request("PUT", f"/api/documents/{note['id']}", {"title": "Plan", "body": "Context", "project": "beta", "expected_revision": note["revision"]})
        self.assertEqual(status, 200)
        self.assertEqual(updated["project"], "beta")
        self.assertEqual(updated["kind"], "roadmap")
        status, _ = self.request("PUT", f"/api/documents/{note['id']}", {"title": "Old", "body": "", "project": "alpha", "expected_revision": "stale"})
        self.assertEqual(status, 409)

    def test_api_rejects_invalid_metadata_without_changing_files(self):
        for field in ("kind", "project", "source"):
            status, _ = self.request("POST", "/api/notes", {"title": "Invalid", field: 42})
            self.assertEqual(status, 400)
        note = self.store.create_note("Safe", "Body")
        for invalid in (42, None, "alpha\ntype: task"):
            status, _ = self.request("PUT", f"/api/documents/{note['id']}", {"title": "Changed", "project": invalid})
            self.assertEqual(status, 400)
        self.assertEqual(self.store.get_document(note["id"])["title"], "Safe")

    def test_whiteboard_uses_markdown_storage_and_revision_protection(self):
        body = '```plainjot-whiteboard\n{"version":1,"width":1600,"height":1000,"elements":[]}\n```'
        status, board = self.request("POST", "/api/notes", {"title": "Architecture", "body": body, "kind": "whiteboard", "project": "plainjot"})
        self.assertEqual(status, 201)
        path = self.store.notes_dir / board["id"]
        self.assertIn("kind: whiteboard", path.read_text())
        self.assertEqual(self.store.get_document(board["id"])["body"], body)
        self.assertEqual(self.store.list_notes()[0]["kind"], "whiteboard")
        path.write_text(path.read_text().replace("Architecture", "External rename"))
        status, _ = self.request("PUT", f"/api/documents/{board['id']}", {"title": "Stale", "body": body, "expected_revision": board["revision"]})
        self.assertEqual(status, 409)
        self.assertEqual(self.store.get_document(board["id"])["title"], "External rename")
        outside = Path(self.temporary.name).parent / "outside-whiteboard.md"
        status, _ = self.request("PUT", "/api/documents/../outside-whiteboard.md", {"title": "Escape", "body": body})
        self.assertEqual(status, 400)
        self.assertFalse(outside.exists())
        symlink = self.store.notes_dir / "linked-whiteboard.md"
        symlink.symlink_to(path)
        status, _ = self.request("PUT", "/api/documents/linked-whiteboard.md", {"title": "Changed", "body": body})
        self.assertEqual(status, 400)
        self.assertEqual(self.store.get_document(board["id"])["title"], "External rename")
        symlink.unlink()
        status, _ = self.request("DELETE", f"/api/documents/{board['id']}")
        self.assertEqual(status, 204)
        self.assertFalse(path.exists())

    def test_create_update_list_and_delete_note(self):
        created = self.store.create_note("Mi idea útil", "Primer contenido")
        self.assertTrue(created["id"].startswith("mi-idea-util-"))
        self.assertEqual(created["title"], "Mi idea útil")
        self.assertEqual(created["body"], "Primer contenido")

        listed = self.store.list_notes()
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["preview"], "Primer contenido")

        updated = self.store.update_note(created["id"], "Idea mejorada", "Nuevo texto")
        self.assertEqual(updated["title"], "Idea mejorada")
        self.assertEqual(updated["body"], "Nuevo texto")

        self.store.delete_note(created["id"])
        self.assertEqual(self.store.list_notes(), [])

    def test_reads_external_markdown_file(self):
        path = Path(self.temporary.name) / "desde-codex.md"
        path.write_text("# Nota desde Codex\n\nContenido externo\n", encoding="utf-8")
        note = self.store.get_note(path.name)
        self.assertEqual(note["title"], "Nota desde Codex")
        self.assertEqual(note["body"], "Contenido externo")

    def test_rejects_path_traversal(self):
        with self.assertRaises(ValueError):
            self.store.get_note("../secreto.md")

    def test_markdown_helpers(self):
        self.assertEqual(slugify("Árbol y Café"), "arbol-y-cafe")
        rendered = render_markdown("Título", "Línea 1\r\nLínea 2")
        title, body = split_markdown(Path("nota.md"), rendered)
        self.assertEqual(title, "Título")
        self.assertEqual(body, "Línea 1\nLínea 2")

    def test_folder_info_reports_the_active_directory(self):
        info = folder_info(Path.home() / "Documents" / "PlainJot")
        self.assertEqual(info["display_path"], "~/Documents/PlainJot")
        self.assertFalse(info["can_choose"])
        self.assertEqual(info["deletion_mode"], "permanent")


if __name__ == "__main__":
    unittest.main()

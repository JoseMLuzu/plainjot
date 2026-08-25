import tempfile
import unittest
from pathlib import Path

from app import NotesStore, render_markdown, slugify, split_markdown


class NotesStoreTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.store = NotesStore(Path(self.temporary.name))

    def tearDown(self):
        self.temporary.cleanup()

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


if __name__ == "__main__":
    unittest.main()

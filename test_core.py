import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from plainjot_core import ConflictError, InvalidDocument, PlainJotStore, parse_frontmatter


TASK_TEXT = """---
type: task
status: inbox
project: plainjot
source: codex
created: 2026-08-24T22:30:00Z
completed:
---

# Add filesystem watcher

Detect external Markdown changes automatically.
"""


class PlainJotCoreTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.store = PlainJotStore(
            self.root,
            clock=lambda: datetime(2026, 8, 24, 22, 30, tzinfo=timezone.utc),
        )

    def tearDown(self):
        self.temporary.cleanup()

    def test_creates_task_with_yaml_frontmatter(self):
        task = self.store.create_task(
            "Add filesystem watcher",
            "Detect changes.",
            project="plainjot",
            source="codex",
        )
        content = (self.root / task["id"]).read_text(encoding="utf-8")
        metadata, _, markdown = parse_frontmatter(content)
        self.assertEqual(metadata["type"], "task")
        self.assertEqual(metadata["status"], "inbox")
        self.assertEqual(metadata["project"], "plainjot")
        self.assertEqual(metadata["source"], "codex")
        self.assertEqual(metadata["created"], "2026-08-24T22:30:00Z")
        self.assertEqual(metadata["completed"], "")
        self.assertIn("# Add filesystem watcher", markdown)

    def test_reads_legacy_note_without_frontmatter(self):
        path = self.root / "legacy-note.md"
        path.write_text("# Legacy note\n\nStill compatible.\n", encoding="utf-8")
        document = self.store.get_document(path.name)
        self.assertEqual(document["type"], "note")
        self.assertEqual(document["title"], "Legacy note")
        self.assertEqual(document["body"], "Still compatible.")

    def test_discovers_task_created_externally(self):
        path = self.root / "external-task.md"
        path.write_text(TASK_TEXT, encoding="utf-8")
        inbox = self.store.list_tasks({"inbox"})
        self.assertEqual([task["id"] for task in inbox], [path.name])
        self.assertEqual(inbox[0]["source"], "codex")

    def test_external_task_without_status_defaults_to_inbox(self):
        content = TASK_TEXT.replace("status: inbox\n", "")
        (self.root / "default-status.md").write_text(content, encoding="utf-8")
        task = self.store.list_tasks()[0]
        self.assertEqual(task["status"], "inbox")

    def test_external_changes_are_visible_without_cache(self):
        path = self.root / "external-note.md"
        path.write_text("# First\n\nOne\n", encoding="utf-8")
        self.assertEqual(self.store.get_document(path.name)["body"], "One")
        path.write_text("# Second\n\nTwo\n", encoding="utf-8")
        self.assertEqual(self.store.get_document(path.name)["body"], "Two")
        path.unlink()
        self.assertEqual(self.store.list_documents(), [])

    def test_malformed_frontmatter_remains_a_plain_note(self):
        path = self.root / "malformed.md"
        path.write_text("---\ntype task\n---\n# Keep this\n", encoding="utf-8")
        document = self.store.get_document(path.name)
        self.assertEqual(document["type"], "note")
        self.assertIn("type task", document["body"])

    def test_invalid_files_are_ignored(self):
        (self.root / "bad name.md").write_text("# Bad name\n", encoding="utf-8")
        (self.root / "invalid.md").write_bytes(b"\xff\xfe")
        (self.root / ".temporary.md").write_text("# Temporary\n", encoding="utf-8")
        self.assertEqual(self.store.list_documents(), [])

    def test_task_with_unknown_external_status_is_ignored(self):
        content = TASK_TEXT.replace("status: inbox", "status: blocked")
        (self.root / "invalid-status.md").write_text(content, encoding="utf-8")
        self.assertEqual(self.store.list_documents(), [])

    def test_generated_names_are_safe_and_unique(self):
        first = self.store.create_note("../../ Árbol útil")
        second = self.store.create_note("../../ Árbol útil")
        self.assertRegex(first["id"], r"^arbol-util-[a-f0-9]{7}\.md$")
        self.assertNotEqual(first["id"], second["id"])

    def test_rejects_path_traversal_and_symlinks(self):
        with self.assertRaises(InvalidDocument):
            self.store.get_document("../outside.md")
        outside = self.root.parent / "plainjot-outside-test.md"
        outside.write_text("# Outside\n", encoding="utf-8")
        link = self.root / "linked.md"
        try:
            os.symlink(outside, link)
            self.assertEqual(self.store.list_documents(), [])
            with self.assertRaises(InvalidDocument):
                self.store.get_document(link.name)
        finally:
            link.unlink(missing_ok=True)
            outside.unlink(missing_ok=True)

    def test_transitions_inbox_to_todo_to_done(self):
        task = self.store.create_task("Transition me")
        todo = self.store.update_task_status(task["id"], "todo")
        self.assertEqual(todo["status"], "todo")
        self.assertEqual(todo["completed"], "")
        done = self.store.update_task_status(task["id"], "done")
        self.assertEqual(done["status"], "done")
        self.assertEqual(done["completed"], "2026-08-24T22:30:00Z")

    def test_rejects_unknown_status(self):
        task = self.store.create_task("Simple states only")
        with self.assertRaises(InvalidDocument):
            self.store.update_task_status(task["id"], "blocked")

    def test_searches_notes_tasks_and_metadata(self):
        self.store.create_note("Authentication notes", "Review session handling")
        self.store.create_task("Clean profiles", project="outcrew", source="codex")
        self.assertEqual(len(self.store.search("authentication")), 1)
        metadata_result = self.store.search("outcrew")
        self.assertEqual(metadata_result[0]["title"], "Clean profiles")

    def test_detects_external_write_conflict(self):
        note = self.store.create_note("Conflict", "Local draft")
        path = self.root / note["id"]
        path.write_text("# Conflict\n\nExternal version changed size.\n", encoding="utf-8")
        with self.assertRaises(ConflictError):
            self.store.update_document(
                note["id"],
                "Conflict",
                "Overwrite attempt",
                expected_revision=note["revision"],
            )
        self.assertIn("External version", path.read_text(encoding="utf-8"))

    def test_external_write_prevents_stale_delete(self):
        note = self.store.create_note("Keep", "Original")
        path = self.root / note["id"]
        path.write_text("# Keep\n\nChanged externally.\n", encoding="utf-8")
        with self.assertRaises(ConflictError):
            self.store.delete_document(note["id"], expected_revision=note["revision"])
        self.assertTrue(path.exists())


if __name__ == "__main__":
    unittest.main()

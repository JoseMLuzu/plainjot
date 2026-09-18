import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from plainjot_core import ConflictError, InvalidDocument, PlainJotStore, default_notes_dir, parse_frontmatter


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

    def test_developer_notes_share_project_source_and_search(self):
        for kind in ("", "debug-journal", "roadmap", "decision", "refactor", "review", "handoff"):
            note = self.store.create_note("Developer note", "Context", kind=kind, project="My project: one", source="claude-code")
            self.assertEqual(note["project"], "My project: one")
            self.assertEqual(note["source"], "claude-code")
            self.assertEqual(note["status"], "")
            metadata, _, _ = parse_frontmatter((self.root / note["id"]).read_text())
            self.assertEqual(metadata["project"], "My project: one")
        self.assertEqual(len(self.store.search("My project: one")), 7)

    def test_project_edits_preserve_comments_unknown_fields_and_task_status(self):
        path = self.root / "external.md"
        raw = "type: task\nstatus: todo\n# Agent context\ncustom: keep\nproject: old\nsource: codex"
        path.write_text(f"---\n{raw}\n---\n\n# External\n\nBody\n")
        doc = self.store.get_document(path.name)
        updated = self.store.update_document(path.name, doc["title"], doc["body"], project='new "project"', expected_revision=doc["revision"])
        self.assertEqual(updated["project"], 'new "project"')
        self.assertEqual(updated["status"], "todo")
        content = path.read_text()
        self.assertIn("# Agent context\ncustom: keep", content)
        self.assertIn("source: codex", content)
        self.store.update_document(path.name, "External", "Body", project="")
        self.assertEqual(self.store.get_document(path.name)["project"], "")

    def test_legacy_note_only_gets_frontmatter_when_project_changes(self):
        note = self.store.create_note("Legacy", "Body")
        self.store.update_document(note["id"], "Legacy", "Body", project="")
        self.assertTrue((self.root / note["id"]).read_text().startswith("# Legacy"))
        updated = self.store.update_document(note["id"], "Legacy", "Body", project="alpha")
        self.assertEqual(updated["type"], "note")
        self.assertEqual(updated["project"], "alpha")

    def test_project_cannot_overflow_frontmatter_parser_limit(self):
        path = self.root / "long-frontmatter.md"
        raw = "type: note\n" + "\n".join("# comment" for _ in range(98))
        content = f"---\n{raw}\n---\n\n# Long\n\nBody\n"
        path.write_text(content)
        self.assertEqual(self.store.get_document(path.name)["title"], "Long")
        with self.assertRaises(InvalidDocument):
            self.store.update_document(path.name, "Long", "Body", project="alpha")
        self.assertEqual(path.read_text(), content)

    def test_project_edits_validate_input_and_revision_before_writing(self):
        note = self.store.create_note("Note", "Body", project="alpha")
        path = self.root / note["id"]
        before = path.read_bytes()
        for project in ("alpha\ntype: task", "x" * 201, 42):
            with self.assertRaises(InvalidDocument):
                self.store.update_document(note["id"], "Note", "Body", project=project)
            with self.assertRaises(InvalidDocument):
                self.store.create_note("Invalid", project=project)
        with self.assertRaises(ConflictError):
            self.store.update_document(note["id"], "Note", "Body", project="beta", expected_revision="stale")
        self.assertEqual(path.read_bytes(), before)

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

    def test_creates_debug_journal_as_a_markdown_note(self):
        journal = self.store.create_note("Bug: Journal no abría", "## Síntoma\n\nNo hacía nada.", kind="debug-journal")
        self.assertEqual(journal["type"], "note")
        self.assertEqual(journal["kind"], "debug-journal")
        content = (self.root / journal["id"]).read_text(encoding="utf-8")
        metadata, _, markdown = parse_frontmatter(content)
        self.assertEqual(metadata["kind"], "debug-journal")
        self.assertEqual(metadata["created"], "2026-08-24T22:30:00Z")
        self.assertIn("# Bug: Journal no abría", markdown)
        self.assertEqual(self.store.list_notes()[0]["kind"], "debug-journal")
        self.assertEqual(self.store.list_tasks(), [])

    def test_debug_journal_metadata_survives_edits(self):
        journal = self.store.create_note("Bug: Journal", "Original", kind="debug-journal")
        updated = self.store.update_document(journal["id"], "Bug: Corregido", "## Qué aprendí\n\nComprobar el evento.", expected_revision=journal["revision"])
        self.assertEqual(updated["kind"], "debug-journal")
        self.assertEqual(updated["title"], "Bug: Corregido")
        self.assertIn(journal["id"], [item["id"] for item in self.store.search("evento")])

    def test_discovers_external_debug_journal_without_title_conventions(self):
        path = self.root / "external-journal.md"
        path.write_text("---\ntype: note\nkind: debug-journal\n---\n\n# State update\n\n## Root cause\n\nsetOpen(false)\n", encoding="utf-8")
        self.assertEqual(self.store.list_notes()[0]["kind"], "debug-journal")
        self.assertEqual(self.store.get_document(path.name)["title"], "State update")

    def test_note_titles_do_not_implicitly_classify_debug_journals(self):
        note = self.store.create_note("Bug: A normal note", "No journal metadata.")
        self.assertEqual(note["kind"], "")
        self.assertFalse((self.root / note["id"]).read_text(encoding="utf-8").startswith("---"))

    def test_invalid_note_kind_cannot_inject_frontmatter(self):
        for kind in ("task", "debug-journal\ntype: task", "../outside"):
            with self.assertRaises(InvalidDocument):
                self.store.create_note("Bad kind", kind=kind)
        self.assertEqual(self.store.list_documents(), [])

    def test_default_directory_uses_shared_configuration(self):
        selected = self.root / "selected"
        selected.mkdir()
        config_file = self.root / "config.json"
        config_file.write_text(json.dumps({"notes_directory": str(selected)}), encoding="utf-8")
        self.assertEqual(default_notes_dir(home=self.root, config_file=config_file), selected.resolve())

    def test_default_directory_ignores_invalid_configuration(self):
        config_file = self.root / "config.json"
        config_file.write_text('{"notes_directory": "relative/path"}', encoding="utf-8")
        self.assertEqual(
            default_notes_dir(home=self.root, config_file=config_file),
            (self.root / "Documents" / "PlainJot").resolve(),
        )

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

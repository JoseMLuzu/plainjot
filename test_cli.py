import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from plainjot_core import PlainJotStore


PROJECT_ROOT = Path(__file__).resolve().parent
CLI = PROJECT_ROOT / "plainjot"


class PlainJotCLITests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.notes_dir = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def run_cli(self, *arguments: str, check: bool = True) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, str(CLI), "--notes-dir", str(self.notes_dir), *arguments],
            cwd=PROJECT_ROOT,
            check=check,
            capture_output=True,
            text=True,
        )

    def test_add_and_list_note(self):
        created = self.run_cli("add", "My note", "--body", "Plain Markdown")
        document_id = created.stdout.strip()
        self.assertTrue((self.notes_dir / document_id).is_file())
        listing = self.run_cli("list")
        self.assertIn("My note", listing.stdout)

    def test_developer_templates_projects_and_handoff(self):
        store = PlainJotStore(self.notes_dir)
        roadmap = self.run_cli("add", "Plan", "--kind", "roadmap", "--project", "alpha", "--source", "codex").stdout.strip()
        self.assertIn("## Por hacer", store.get_document(roadmap)["body"])
        self.assertEqual(store.get_document(roadmap)["source"], "codex")
        handoff = self.run_cli("add", "Session", "--kind", "handoff", "--project", "beta").stdout.strip()
        self.assertIn("## Próximo paso", store.get_document(handoff)["body"])
        self.assertIn(roadmap, self.run_cli("list", "--project", "alpha").stdout)
        self.assertNotIn(handoff, self.run_cli("list", "--project", "alpha").stdout)
        self.assertNotIn(roadmap, self.run_cli("search", "Plan", "--project", "beta").stdout)
        ticket = self.run_cli("task", "Fix login", "--template", "ticket", "--project", "alpha").stdout.strip()
        self.assertIn("- [ ]", store.get_document(ticket)["body"])
        self.assertEqual(store.get_document(ticket)["status"], "inbox")
        self.assertIn(ticket, self.run_cli("list", "--inbox", "--project", "alpha").stdout)
        custom = self.run_cli("add", "Custom", "--kind", "review", "--body", "").stdout.strip()
        self.assertEqual(store.get_document(custom)["body"], "")

    def test_task_inbox_search_and_done(self):
        created = self.run_cli(
            "task",
            "Fix authentication",
            "--project",
            "plainjot",
            "--source",
            "codex",
        )
        document_id = created.stdout.strip()
        inbox = self.run_cli("list", "--inbox")
        self.assertIn("Fix authentication", inbox.stdout)
        self.assertIn("plainjot · codex", inbox.stdout)
        search = self.run_cli("search", "authentication")
        self.assertIn(document_id, search.stdout)

        prefix = document_id.removesuffix(".md")[:12]
        completed = self.run_cli("done", prefix)
        self.assertIn("✓ Fix authentication", completed.stdout)
        task = PlainJotStore(self.notes_dir).get_document(document_id)
        self.assertEqual(task["status"], "done")
        self.assertTrue(task["completed"])

    def test_done_rejects_unknown_task(self):
        result = self.run_cli("done", "missing-task", check=False)
        self.assertEqual(result.returncode, 1)
        self.assertIn("task not found", result.stderr)

    def test_add_and_list_debug_journals(self):
        created = self.run_cli("add", "Bug: Journal", "--kind", "debug-journal", "--body", "## Root cause\n\nWrong state update.")
        self.run_cli("add", "Ordinary note")
        journal_id = created.stdout.strip()
        self.assertEqual(PlainJotStore(self.notes_dir).get_document(journal_id)["kind"], "debug-journal")
        listing = self.run_cli("list", "--journals")
        self.assertIn(journal_id, listing.stdout)
        self.assertNotIn("Ordinary note", listing.stdout)
        self.assertIn(journal_id, self.run_cli("list").stdout)
        self.assertIn(journal_id, self.run_cli("search", "state update").stdout)

    def test_agent_can_create_and_list_analyses_in_the_same_folder(self):
        analysis_id = self.run_cli("add", "Login analysis", "--kind", "analysis", "--project", "alpha", "--source", "codex").stdout.strip()
        other_id = self.run_cli("add", "Ordinary note").stdout.strip()
        doc = PlainJotStore(self.notes_dir).get_document(analysis_id)
        self.assertEqual(doc["kind"], "analysis")
        self.assertIn("## Hallazgos", doc["body"])
        listing = self.run_cli("list", "--analyses", "--project", "alpha").stdout
        self.assertIn(analysis_id, listing)
        self.assertNotIn(other_id, listing)

    def test_agent_can_build_project_relationships(self):
        root = self.run_cli("add", "Roadmap", "--kind", "roadmap", "--project", "alpha").stdout.strip()
        idea = self.run_cli("add", "Offline idea", "--kind", "idea", "--project", "alpha", "--parent", root).stdout.strip()
        task = self.run_cli("task", "Prototype offline mode", "--project", "alpha", "--parent", idea).stdout.strip()
        store = PlainJotStore(self.notes_dir)
        self.assertEqual(store.get_document(idea)["parent"], root)
        self.assertEqual(store.get_document(task)["parent"], idea)
        invalid = self.run_cli("add", "Unsafe", "--parent", "../outside.md", check=False)
        self.assertEqual(invalid.returncode, 1)
        self.assertFalse((self.notes_dir.parent / "outside.md").exists())


if __name__ == "__main__":
    unittest.main()

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


if __name__ == "__main__":
    unittest.main()

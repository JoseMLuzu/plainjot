"""Command-line interface for PlainJot."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .core import InvalidDocument, PlainJotStore, default_notes_dir
from .templates import get_template, list_templates


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="plainjot",
        description="Notes and tasks stored as local Markdown files.",
    )
    parser.add_argument(
        "--notes-dir",
        type=Path,
        default=None,
        help="PlainJot directory (default: the folder selected in the macOS app)",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    add = commands.add_parser("add", help="Create a note")
    add.add_argument("title")
    add.add_argument("--body", default=None)
    add.add_argument("--kind", choices=tuple(t["id"] for t in list_templates() if t["type"] == "note"), default="", help="Use a developer note template")
    add.add_argument("--project", default="")
    add.add_argument("--source", default="")
    add.add_argument("--parent", default="", help="Parent Markdown filename for the project map")

    task = commands.add_parser("task", help="Create a task in the agent inbox")
    task.add_argument("title")
    task.add_argument("--body", default=None)
    task.add_argument("--template", choices=("ticket",), help="Use acceptance criteria and implementation prompts")
    task.add_argument("--project", default="")
    task.add_argument("--source", default="")
    task.add_argument("--status", choices=("inbox", "todo"), default="inbox")
    task.add_argument("--parent", default="", help="Parent Markdown filename for the project map")

    listing = commands.add_parser("list", help="List notes or tasks")
    listing.add_argument("--project", help="Filter by exact project name")
    filters = listing.add_mutually_exclusive_group()
    filters.add_argument("--tasks", action="store_true", help="List todo and completed tasks")
    filters.add_argument("--inbox", action="store_true", help="List inbox tasks")
    filters.add_argument("--journals", action="store_true", help="List Debug Journal notes")
    filters.add_argument("--analyses", action="store_true", help="List analysis notes")

    search = commands.add_parser("search", help="Search all notes and tasks")
    search.add_argument("query")
    search.add_argument("--project", help="Filter by exact project name")

    done = commands.add_parser("done", help="Mark a task as done")
    done.add_argument("task", help="Task filename, unique filename prefix, or exact title")
    return parser


def _print_items(items: list[dict]) -> None:
    if not items:
        print("No matching items.")
        return
    for item in items:
        context = " · ".join(value for value in (item.get("project"), item.get("source")) if value)
        suffix = f"  {context}" if context else ""
        if item["type"] == "task":
            mark = "✓" if item["status"] == "done" else "○"
            print(f"{mark} {item['title']}  [{item['id']}]{suffix}")
        else:
            print(f"• {item['title']}  [{item['id']}]{suffix}")


def _creation_body(body: str | None, template: str | None) -> str:
    if body is not None:
        return body
    return get_template(template)["body"] if template else ""


def run(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    store = PlainJotStore(args.notes_dir or default_notes_dir())

    if args.command == "add":
        body = _creation_body(args.body, args.kind)
        document = store.create_note(args.title, body, kind=args.kind, project=args.project, source=args.source, parent=args.parent)
        print(document["id"])
    elif args.command == "task":
        document = store.create_task(
            args.title,
            _creation_body(args.body, args.template),
            status=args.status,
            project=args.project,
            source=args.source,
            parent=args.parent,
        )
        print(document["id"])
    elif args.command == "list":
        if args.inbox:
            items = store.list_tasks({"inbox"})
        elif args.tasks:
            items = store.list_tasks({"todo", "done"})
        elif args.journals:
            items = [note for note in store.list_notes() if note["kind"] == "debug-journal"]
        elif args.analyses:
            items = [note for note in store.list_notes() if note["kind"] == "analysis"]
        else:
            items = store.list_notes()
        _print_items([item for item in items if args.project is None or item["project"] == args.project])
    elif args.command == "search":
        _print_items([item for item in store.search(args.query) if args.project is None or item["project"] == args.project])
    elif args.command == "done":
        document = store.complete_task(args.task)
        print(f"✓ {document['title']}  [{document['id']}]")
    return 0


def main() -> None:
    try:
        raise SystemExit(run())
    except FileNotFoundError as error:
        print(f"plainjot: task not found: {error.args[0]}", file=sys.stderr)
        raise SystemExit(1) from error
    except (InvalidDocument, OSError) as error:
        print(f"plainjot: {error}", file=sys.stderr)
        raise SystemExit(1) from error

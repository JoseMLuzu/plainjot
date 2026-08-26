"""Command-line interface for PlainJot."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .core import InvalidDocument, PlainJotStore, default_notes_dir


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="plainjot",
        description="Notes and tasks stored as local Markdown files.",
    )
    parser.add_argument(
        "--notes-dir",
        type=Path,
        default=None,
        help="PlainJot directory (default: ~/Documents/PlainJot)",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    add = commands.add_parser("add", help="Create a note")
    add.add_argument("title")
    add.add_argument("--body", default="")

    task = commands.add_parser("task", help="Create a task in the agent inbox")
    task.add_argument("title")
    task.add_argument("--body", default="")
    task.add_argument("--project", default="")
    task.add_argument("--source", default="")
    task.add_argument("--status", choices=("inbox", "todo"), default="inbox")

    listing = commands.add_parser("list", help="List notes or tasks")
    filters = listing.add_mutually_exclusive_group()
    filters.add_argument("--tasks", action="store_true", help="List todo and completed tasks")
    filters.add_argument("--inbox", action="store_true", help="List inbox tasks")

    search = commands.add_parser("search", help="Search all notes and tasks")
    search.add_argument("query")

    done = commands.add_parser("done", help="Mark a task as done")
    done.add_argument("task", help="Task filename, unique filename prefix, or exact title")
    return parser


def _print_items(items: list[dict]) -> None:
    if not items:
        print("No matching items.")
        return
    for item in items:
        if item["type"] == "task":
            mark = "✓" if item["status"] == "done" else "○"
            context = " · ".join(value for value in (item.get("project"), item.get("source")) if value)
            suffix = f"  {context}" if context else ""
            print(f"{mark} {item['title']}  [{item['id']}]{suffix}")
        else:
            print(f"• {item['title']}  [{item['id']}]")


def run(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    store = PlainJotStore(args.notes_dir or default_notes_dir())

    if args.command == "add":
        document = store.create_note(args.title, args.body)
        print(document["id"])
    elif args.command == "task":
        document = store.create_task(
            args.title,
            args.body,
            status=args.status,
            project=args.project,
            source=args.source,
        )
        print(document["id"])
    elif args.command == "list":
        if args.inbox:
            _print_items(store.list_tasks({"inbox"}))
        elif args.tasks:
            _print_items(store.list_tasks({"todo", "done"}))
        else:
            _print_items(store.list_notes())
    elif args.command == "search":
        _print_items(store.search(args.query))
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

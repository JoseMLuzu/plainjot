#!/usr/bin/env python3
"""Dependency-free development server for PlainJot's shared frontend."""

from __future__ import annotations

import argparse
import json
import mimetypes
import threading
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from plainjot_core import (
    ConflictError,
    InvalidDocument,
    PlainJotStore,
    default_notes_dir,
    parse_markdown,
    render_markdown,
    slugify,
)


APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"
MAX_BODY_BYTES = 2 * 1024 * 1024

# Compatibility aliases for the original public Python API and tests.
NotesStore = PlainJotStore


def split_markdown(path: Path, content: str) -> tuple[str, str]:
    title, body, _, _ = parse_markdown(path, content)
    return title, body


def make_handler(store: PlainJotStore):
    class PlainJotHandler(BaseHTTPRequestHandler):
        server_version = "PlainJot/0.2"

        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            route = parsed.path
            if route == "/api/notes":
                self._send_json(store.list_notes())
                return
            if route == "/api/tasks":
                self._send_json(store.list_tasks())
                return
            if route == "/api/search":
                query = parse_qs(parsed.query).get("q", [""])[0]
                self._send_json(store.search(query))
                return
            document_id = self._id_after(route, "/api/documents/")
            if document_id is None:
                document_id = self._id_after(route, "/api/notes/")
            if document_id is not None:
                self._with_store(lambda: store.get_document(document_id))
                return
            self._serve_static(route)

        def do_POST(self) -> None:
            route = urlparse(self.path).path
            payload = self._read_json()
            if payload is None:
                return
            fields = self._document_fields(payload)
            if fields is None:
                return
            title, body = fields
            if route == "/api/notes":
                self._with_store(lambda: store.create_note(title, body), HTTPStatus.CREATED)
                return
            if route == "/api/tasks":
                status = payload.get("status", "inbox")
                project = payload.get("project", "")
                source = payload.get("source", "")
                if not all(isinstance(value, str) for value in (status, project, source)):
                    self._send_error(HTTPStatus.BAD_REQUEST, "Task metadata must be text")
                    return
                self._with_store(
                    lambda: store.create_task(
                        title,
                        body,
                        status=status,
                        project=project,
                        source=source,
                    ),
                    HTTPStatus.CREATED,
                )
                return
            self._send_error(HTTPStatus.NOT_FOUND, "Route not found")

        def do_PUT(self) -> None:
            route = urlparse(self.path).path
            document_id = self._id_after(route, "/api/documents/")
            if document_id is None:
                document_id = self._id_after(route, "/api/notes/")
            if document_id is None:
                self._send_error(HTTPStatus.NOT_FOUND, "Route not found")
                return
            payload = self._read_json()
            if payload is None:
                return
            fields = self._document_fields(payload)
            if fields is None:
                return
            expected = payload.get("expected_revision")
            if expected is not None and not isinstance(expected, str):
                self._send_error(HTTPStatus.BAD_REQUEST, "Revision must be text")
                return
            self._with_store(
                lambda: store.update_document(
                    document_id,
                    fields[0],
                    fields[1],
                    expected_revision=expected,
                )
            )

        def do_PATCH(self) -> None:
            route = urlparse(self.path).path
            document_id = self._id_after(route, "/api/tasks/")
            if document_id is None:
                self._send_error(HTTPStatus.NOT_FOUND, "Route not found")
                return
            payload = self._read_json()
            if payload is None:
                return
            status = payload.get("status")
            expected = payload.get("expected_revision")
            if not isinstance(status, str) or (expected is not None and not isinstance(expected, str)):
                self._send_error(HTTPStatus.BAD_REQUEST, "Status and revision must be text")
                return
            self._with_store(
                lambda: store.update_task_status(
                    document_id,
                    status,
                    expected_revision=expected,
                )
            )

        def do_DELETE(self) -> None:
            route = urlparse(self.path).path
            document_id = self._id_after(route, "/api/documents/")
            if document_id is None:
                document_id = self._id_after(route, "/api/notes/")
            if document_id is None:
                self._send_error(HTTPStatus.NOT_FOUND, "Route not found")
                return
            try:
                has_body = int(self.headers.get("Content-Length", "0")) > 0
            except ValueError:
                self._send_error(HTTPStatus.BAD_REQUEST, "Invalid request size")
                return
            payload = self._read_json() if has_body else {}
            if payload is None:
                return
            expected = payload.get("expected_revision")
            if expected is not None and not isinstance(expected, str):
                self._send_error(HTTPStatus.BAD_REQUEST, "Revision must be text")
                return
            self._with_store(
                lambda: store.delete_document(document_id, expected_revision=expected),
                HTTPStatus.NO_CONTENT,
            )

        @staticmethod
        def _id_after(route: str, prefix: str) -> str | None:
            if not route.startswith(prefix):
                return None
            return unquote(route.removeprefix(prefix))

        def _with_store(self, operation, status: HTTPStatus = HTTPStatus.OK) -> None:
            try:
                result = operation()
            except FileNotFoundError:
                self._send_error(HTTPStatus.NOT_FOUND, "Document does not exist")
            except ConflictError as error:
                self._send_error(HTTPStatus.CONFLICT, str(error))
            except InvalidDocument as error:
                self._send_error(HTTPStatus.BAD_REQUEST, str(error))
            except OSError:
                self._send_error(HTTPStatus.INTERNAL_SERVER_ERROR, "Could not access the notes directory")
            else:
                if status == HTTPStatus.NO_CONTENT:
                    self.send_response(status)
                    self.end_headers()
                else:
                    self._send_json(result, status)

        def _serve_static(self, route: str) -> None:
            filename = "index.html" if route in ("", "/") else route.lstrip("/")
            if filename not in {"index.html", "app.js", "style.css"}:
                self._send_error(HTTPStatus.NOT_FOUND, "Route not found")
                return
            path = STATIC_DIR / filename
            try:
                content = path.read_bytes()
            except OSError:
                self._send_error(HTTPStatus.NOT_FOUND, "File not found")
                return
            content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", f"{content_type}; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(content)

        def _read_json(self) -> dict | None:
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self._send_error(HTTPStatus.BAD_REQUEST, "Invalid request size")
                return None
            if length <= 0 or length > MAX_BODY_BYTES:
                self._send_error(HTTPStatus.BAD_REQUEST, "Request is empty or too large")
                return None
            try:
                payload = json.loads(self.rfile.read(length))
            except (json.JSONDecodeError, UnicodeDecodeError):
                self._send_error(HTTPStatus.BAD_REQUEST, "Invalid JSON")
                return None
            if not isinstance(payload, dict):
                self._send_error(HTTPStatus.BAD_REQUEST, "Payload must be an object")
                return None
            return payload

        def _document_fields(self, payload: dict) -> tuple[str, str] | None:
            title = payload.get("title", "")
            body = payload.get("body", "")
            if not isinstance(title, str) or not isinstance(body, str):
                self._send_error(HTTPStatus.BAD_REQUEST, "Title and body must be text")
                return None
            return title, body

        def _send_json(self, payload, status: HTTPStatus = HTTPStatus.OK) -> None:
            content = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)

        def _send_error(self, status: HTTPStatus, message: str) -> None:
            self._send_json({"error": message}, status)

        def log_message(self, format: str, *args) -> None:
            return

    return PlainJotHandler


class LocalServer(ThreadingHTTPServer):
    allow_reuse_address = True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="PlainJot development server")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--notes-dir", type=Path, default=None)
    parser.add_argument("--no-browser", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    store = PlainJotStore(args.notes_dir or default_notes_dir())
    server = LocalServer(("127.0.0.1", args.port), make_handler(store))
    url = f"http://127.0.0.1:{args.port}"
    print(f"PlainJot is open at {url}")
    print(f"Your files are stored in {store.notes_dir}")
    print("Press Ctrl+C to stop.")
    if not args.no_browser:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nClosing PlainJot…")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Servidor local, sin dependencias, para una carpeta de notas Markdown."""

from __future__ import annotations

import argparse
import json
import mimetypes
import re
import threading
import unicodedata
import uuid
import webbrowser
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"
PREFERRED_NOTES_DIR = Path.home() / "Documents" / "PlainJot"
LEGACY_NOTES_DIR = Path.home() / "Documents" / "NotasLocal"
MAX_BODY_BYTES = 2 * 1024 * 1024
VALID_NOTE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*\.md$")


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_value).strip("-").lower()
    return slug[:60] or "nota"


def split_markdown(path: Path, content: str) -> tuple[str, str]:
    lines = content.splitlines()
    if lines and lines[0].startswith("# "):
        title = lines[0][2:].strip() or path.stem
        body_lines = lines[1:]
        if body_lines and body_lines[0] == "":
            body_lines = body_lines[1:]
        return title, "\n".join(body_lines)
    return path.stem.replace("-", " ").strip().title(), content


def render_markdown(title: str, body: str) -> str:
    safe_title = " ".join(title.replace("\r", " ").replace("\n", " ").split())
    safe_title = safe_title or "Sin título"
    clean_body = body.replace("\r\n", "\n").replace("\r", "\n")
    return f"# {safe_title}\n\n{clean_body.rstrip()}\n"


class NotesStore:
    def __init__(self, notes_dir: Path):
        self.notes_dir = notes_dir.expanduser().resolve()
        self.notes_dir.mkdir(parents=True, exist_ok=True)

    def _path_for(self, note_id: str) -> Path:
        if not VALID_NOTE_NAME.fullmatch(note_id):
            raise ValueError("Nombre de nota no válido")
        path = (self.notes_dir / note_id).resolve()
        if path.parent != self.notes_dir:
            raise ValueError("Ruta de nota no válida")
        return path

    def list_notes(self) -> list[dict]:
        notes = []
        for path in self.notes_dir.glob("*.md"):
            if not path.is_file() or not VALID_NOTE_NAME.fullmatch(path.name):
                continue
            try:
                content = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            title, body = split_markdown(path, content)
            stat = path.stat()
            preview = " ".join(body.replace("#", "").split())[:140]
            notes.append(
                {
                    "id": path.name,
                    "title": title,
                    "preview": preview,
                    "modified": datetime.fromtimestamp(
                        stat.st_mtime, tz=timezone.utc
                    ).isoformat(),
                }
            )
        return sorted(notes, key=lambda note: note["modified"], reverse=True)

    def get_note(self, note_id: str) -> dict:
        path = self._path_for(note_id)
        if not path.is_file():
            raise FileNotFoundError(note_id)
        content = path.read_text(encoding="utf-8")
        title, body = split_markdown(path, content)
        return {"id": path.name, "title": title, "body": body}

    def create_note(self, title: str, body: str) -> dict:
        title = title.strip() or "Sin título"
        note_id = f"{slugify(title)}-{uuid.uuid4().hex[:7]}.md"
        path = self._path_for(note_id)
        self._atomic_write(path, render_markdown(title, body))
        return self.get_note(note_id)

    def update_note(self, note_id: str, title: str, body: str) -> dict:
        path = self._path_for(note_id)
        if not path.is_file():
            raise FileNotFoundError(note_id)
        self._atomic_write(path, render_markdown(title, body))
        return self.get_note(note_id)

    def delete_note(self, note_id: str) -> None:
        path = self._path_for(note_id)
        if not path.is_file():
            raise FileNotFoundError(note_id)
        path.unlink()

    @staticmethod
    def _atomic_write(path: Path, content: str) -> None:
        temporary = path.with_suffix(".md.tmp")
        temporary.write_text(content, encoding="utf-8")
        temporary.replace(path)


def make_handler(store: NotesStore):
    class NotesHandler(BaseHTTPRequestHandler):
        server_version = "PlainJot/1.0"

        def do_GET(self) -> None:
            route = urlparse(self.path).path
            if route == "/api/notes":
                self._send_json(store.list_notes())
                return
            if route.startswith("/api/notes/"):
                self._handle_get_note(unquote(route.removeprefix("/api/notes/")))
                return
            self._serve_static(route)

        def do_POST(self) -> None:
            if urlparse(self.path).path != "/api/notes":
                self._send_error(HTTPStatus.NOT_FOUND, "Ruta no encontrada")
                return
            payload = self._read_json()
            if payload is None:
                return
            title, body = self._note_fields(payload)
            if title is None:
                return
            self._send_json(store.create_note(title, body), HTTPStatus.CREATED)

        def do_PUT(self) -> None:
            route = urlparse(self.path).path
            if not route.startswith("/api/notes/"):
                self._send_error(HTTPStatus.NOT_FOUND, "Ruta no encontrada")
                return
            payload = self._read_json()
            if payload is None:
                return
            title, body = self._note_fields(payload)
            if title is None:
                return
            note_id = unquote(route.removeprefix("/api/notes/"))
            try:
                note = store.update_note(note_id, title, body)
            except FileNotFoundError:
                self._send_error(HTTPStatus.NOT_FOUND, "La nota no existe")
                return
            except ValueError as error:
                self._send_error(HTTPStatus.BAD_REQUEST, str(error))
                return
            self._send_json(note)

        def do_DELETE(self) -> None:
            route = urlparse(self.path).path
            if not route.startswith("/api/notes/"):
                self._send_error(HTTPStatus.NOT_FOUND, "Ruta no encontrada")
                return
            note_id = unquote(route.removeprefix("/api/notes/"))
            try:
                store.delete_note(note_id)
            except FileNotFoundError:
                self._send_error(HTTPStatus.NOT_FOUND, "La nota no existe")
                return
            except ValueError as error:
                self._send_error(HTTPStatus.BAD_REQUEST, str(error))
                return
            self.send_response(HTTPStatus.NO_CONTENT)
            self.end_headers()

        def _handle_get_note(self, note_id: str) -> None:
            try:
                note = store.get_note(note_id)
            except FileNotFoundError:
                self._send_error(HTTPStatus.NOT_FOUND, "La nota no existe")
                return
            except ValueError as error:
                self._send_error(HTTPStatus.BAD_REQUEST, str(error))
                return
            self._send_json(note)

        def _serve_static(self, route: str) -> None:
            filename = "index.html" if route in ("", "/") else route.lstrip("/")
            if filename not in {"index.html", "app.js", "style.css"}:
                self._send_error(HTTPStatus.NOT_FOUND, "Ruta no encontrada")
                return
            path = STATIC_DIR / filename
            try:
                content = path.read_bytes()
            except OSError:
                self._send_error(HTTPStatus.NOT_FOUND, "Archivo no encontrado")
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
                self._send_error(HTTPStatus.BAD_REQUEST, "Tamaño de solicitud inválido")
                return None
            if length <= 0 or length > MAX_BODY_BYTES:
                self._send_error(HTTPStatus.BAD_REQUEST, "Solicitud vacía o demasiado grande")
                return None
            try:
                payload = json.loads(self.rfile.read(length))
            except (json.JSONDecodeError, UnicodeDecodeError):
                self._send_error(HTTPStatus.BAD_REQUEST, "JSON inválido")
                return None
            if not isinstance(payload, dict):
                self._send_error(HTTPStatus.BAD_REQUEST, "El contenido debe ser un objeto")
                return None
            return payload

        def _note_fields(self, payload: dict) -> tuple[str | None, str]:
            title = payload.get("title", "")
            body = payload.get("body", "")
            if not isinstance(title, str) or not isinstance(body, str):
                self._send_error(HTTPStatus.BAD_REQUEST, "Título y contenido deben ser texto")
                return None, ""
            if len(title) > 200:
                self._send_error(HTTPStatus.BAD_REQUEST, "El título es demasiado largo")
                return None, ""
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

    return NotesHandler


class LocalServer(ThreadingHTTPServer):
    allow_reuse_address = True


def default_notes_dir() -> Path:
    """Use PlainJot's folder and migrate the previous app folder when possible."""
    if PREFERRED_NOTES_DIR.exists() or not LEGACY_NOTES_DIR.is_dir():
        return PREFERRED_NOTES_DIR
    try:
        LEGACY_NOTES_DIR.replace(PREFERRED_NOTES_DIR)
    except OSError:
        return LEGACY_NOTES_DIR
    return PREFERRED_NOTES_DIR


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="PlainJot, notas Markdown locales")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--notes-dir", type=Path, default=default_notes_dir())
    parser.add_argument("--no-browser", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    store = NotesStore(args.notes_dir)
    server = LocalServer(("127.0.0.1", args.port), make_handler(store))
    url = f"http://127.0.0.1:{args.port}"
    print(f"PlainJot está abierta en {url}")
    print(f"Tus notas se guardan en {store.notes_dir}")
    print("Presiona Ctrl+C para cerrar.")
    if not args.no_browser:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nCerrando PlainJot…")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

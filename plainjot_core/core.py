"""PlainJot's dependency-free Markdown filesystem core."""

from __future__ import annotations

import json
import os
import re
import unicodedata
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable


MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_TITLE_LENGTH = 200
MAX_METADATA_LENGTH = 200
TASK_STATUSES = frozenset({"inbox", "todo", "done"})
TASK_FIELDS = ("type", "status", "project", "source", "created", "completed")
VALID_DOCUMENT_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*\.md$")
VALID_FRONTMATTER_KEY = re.compile(r"^[A-Za-z][A-Za-z0-9_-]*$")
SAFE_YAML_VALUE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/@:+-]*$")


class PlainJotError(Exception):
    """Base error for expected PlainJot failures."""


class InvalidDocument(PlainJotError, ValueError):
    """Raised when a document name or content is unsafe or unsupported."""


class ConflictError(PlainJotError):
    """Raised when an external edit happened before a pending write."""


@dataclass(frozen=True)
class Document:
    id: str
    title: str
    body: str
    metadata: dict[str, str]
    frontmatter_raw: str | None
    modified: str
    revision: str

    @property
    def is_task(self) -> bool:
        return self.metadata.get("type", "").lower() == "task"

    @property
    def status(self) -> str:
        return self.metadata.get("status", "inbox") if self.is_task else ""

    def as_dict(self) -> dict:
        result = {
            "id": self.id,
            "title": self.title,
            "body": self.body,
            "type": "task" if self.is_task else "note",
            "modified": self.modified,
            "revision": self.revision,
        }
        for key in TASK_FIELDS[1:]:
            result[key] = (self.status if key == "status" else self.metadata.get(key, "")) if self.is_task else ""
        return result


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_value).strip("-").lower()
    return slug[:60] or "note"


def _parse_scalar(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] == '"':
        try:
            decoded = json.loads(value)
        except json.JSONDecodeError:
            return value[1:-1]
        return decoded if isinstance(decoded, str) else str(decoded)
    if len(value) >= 2 and value[0] == value[-1] == "'":
        return value[1:-1].replace("''", "'")
    return value


def parse_frontmatter(content: str) -> tuple[dict[str, str], str | None, str]:
    """Parse PlainJot's small YAML scalar subset without a YAML dependency."""
    normalized = content.replace("\r\n", "\n").replace("\r", "\n")
    lines = normalized.split("\n")
    if not lines or lines[0].strip() != "---":
        return {}, None, normalized

    closing = next((index for index, line in enumerate(lines[1:101], 1) if line.strip() == "---"), None)
    if closing is None:
        return {}, None, normalized

    raw_lines = lines[1:closing]
    metadata: dict[str, str] = {}
    for line in raw_lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if ":" not in line:
            return {}, None, normalized
        key, value = line.split(":", 1)
        key = key.strip()
        if not VALID_FRONTMATTER_KEY.fullmatch(key):
            return {}, None, normalized
        metadata[key] = _parse_scalar(value)

    remaining = lines[closing + 1 :]
    if remaining and remaining[0] == "":
        remaining = remaining[1:]
    return metadata, "\n".join(raw_lines), "\n".join(remaining)


def parse_markdown(path: Path, content: str) -> tuple[str, str, dict[str, str], str | None]:
    metadata, frontmatter_raw, markdown = parse_frontmatter(content)
    lines = markdown.splitlines()
    if lines and lines[0].startswith("# "):
        title = lines[0][2:].strip() or path.stem
        body_lines = lines[1:]
        if body_lines and body_lines[0] == "":
            body_lines = body_lines[1:]
        body = "\n".join(body_lines)
    else:
        title = path.stem.replace("-", " ").strip().title()
        body = "\n".join(lines)
    return title[:MAX_TITLE_LENGTH], body, metadata, frontmatter_raw


def _clean_title(title: str) -> str:
    if not isinstance(title, str):
        raise InvalidDocument("Title must be text")
    clean = " ".join(title.replace("\r", " ").replace("\n", " ").split()) or "Untitled"
    if len(clean) > MAX_TITLE_LENGTH:
        raise InvalidDocument("Title is too long")
    return clean


def _clean_body(body: str) -> str:
    if not isinstance(body, str):
        raise InvalidDocument("Body must be text")
    if len(body.encode("utf-8")) > MAX_FILE_BYTES:
        raise InvalidDocument("Document is too large")
    return body.replace("\r\n", "\n").replace("\r", "\n").rstrip()


def render_markdown(title: str, body: str) -> str:
    return f"# {_clean_title(title)}\n\n{_clean_body(body)}\n"


def _format_yaml_value(value: str) -> str:
    if not value:
        return ""
    if SAFE_YAML_VALUE.fullmatch(value):
        return value
    return json.dumps(value, ensure_ascii=False)


def _render_frontmatter(metadata: dict[str, str]) -> str:
    ordered = list(TASK_FIELDS) + sorted(key for key in metadata if key not in TASK_FIELDS)
    lines = [f"{key}: {_format_yaml_value(metadata.get(key, ''))}" for key in ordered if key in metadata or key in TASK_FIELDS]
    return "\n".join(lines)


def render_task(title: str, body: str, metadata: dict[str, str]) -> str:
    values = {key: str(value) for key, value in metadata.items()}
    values["type"] = "task"
    status = values.get("status", "inbox").lower()
    if status not in TASK_STATUSES:
        raise InvalidDocument(f"Unsupported task status: {status}")
    values["status"] = status
    for key in ("project", "source", "created", "completed"):
        values.setdefault(key, "")
    return f"---\n{_render_frontmatter(values)}\n---\n\n{render_markdown(title, body)}"


def _render_preserving_frontmatter(title: str, body: str, frontmatter_raw: str | None) -> str:
    markdown = render_markdown(title, body)
    return f"---\n{frontmatter_raw}\n---\n\n{markdown}" if frontmatter_raw is not None else markdown


def default_notes_dir() -> Path:
    preferred = Path.home() / "Documents" / "PlainJot"
    legacy = Path.home() / "Documents" / "NotasLocal"
    if preferred.exists() or not legacy.is_dir():
        return preferred
    try:
        legacy.replace(preferred)
    except OSError:
        return legacy
    return preferred


class PlainJotStore:
    """Read and write PlainJot documents inside one authorized directory."""

    def __init__(self, notes_dir: Path, clock: Callable[[], datetime] | None = None):
        self.notes_dir = notes_dir.expanduser().resolve()
        self.notes_dir.mkdir(parents=True, exist_ok=True)
        if not self.notes_dir.is_dir():
            raise InvalidDocument("PlainJot path is not a directory")
        self._clock = clock or (lambda: datetime.now(timezone.utc))

    def _path_for(self, document_id: str) -> Path:
        if not isinstance(document_id, str) or not VALID_DOCUMENT_NAME.fullmatch(document_id):
            raise InvalidDocument("Invalid document name")
        candidate = self.notes_dir / document_id
        if candidate.is_symlink():
            raise InvalidDocument("Symbolic links are not supported")
        resolved = candidate.resolve(strict=False)
        if resolved.parent != self.notes_dir:
            raise InvalidDocument("Document path leaves the PlainJot directory")
        return candidate

    def _read(self, path: Path) -> Document:
        if path.is_symlink() or not path.is_file():
            raise FileNotFoundError(path.name)
        stat = path.stat()
        if stat.st_size > MAX_FILE_BYTES:
            raise InvalidDocument("Document is too large")
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError as error:
            raise InvalidDocument("Document is not valid UTF-8") from error
        title, body, metadata, raw = parse_markdown(path, content)
        if metadata.get("type", "").lower() == "task":
            status = metadata.get("status", "inbox").lower()
            if status not in TASK_STATUSES:
                raise InvalidDocument(f"Unsupported task status: {status}")
        modified = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
        return Document(
            id=path.name,
            title=title,
            body=body,
            metadata=metadata,
            frontmatter_raw=raw,
            modified=modified,
            revision=f"{stat.st_mtime_ns}:{stat.st_size}",
        )

    def _iter_documents(self) -> Iterable[Document]:
        for path in self.notes_dir.glob("*.md"):
            if not VALID_DOCUMENT_NAME.fullmatch(path.name) or path.is_symlink():
                continue
            try:
                yield self._read(path)
            except (OSError, InvalidDocument):
                continue

    @staticmethod
    def _summary(document: Document) -> dict:
        preview = " ".join(document.body.replace("#", "").split())[:140]
        result = document.as_dict()
        result.pop("body")
        result["preview"] = preview
        return result

    def list_documents(self) -> list[dict]:
        documents = [self._summary(document) for document in self._iter_documents()]
        return sorted(documents, key=lambda item: item["modified"], reverse=True)

    def list_notes(self) -> list[dict]:
        return [item for item in self.list_documents() if item["type"] == "note"]

    def list_tasks(self, statuses: Iterable[str] | None = None) -> list[dict]:
        allowed = set(statuses) if statuses is not None else None
        return [
            item
            for item in self.list_documents()
            if item["type"] == "task" and (allowed is None or item["status"] in allowed)
        ]

    def get_document(self, document_id: str) -> dict:
        return self._read(self._path_for(document_id)).as_dict()

    def get_note(self, document_id: str) -> dict:
        return self.get_document(document_id)

    def create_note(self, title: str, body: str = "") -> dict:
        clean_title = _clean_title(title)
        document_id = f"{slugify(clean_title)}-{uuid.uuid4().hex[:7]}.md"
        path = self._path_for(document_id)
        self._atomic_write(path, render_markdown(clean_title, body))
        return self.get_document(document_id)

    def create_task(
        self,
        title: str,
        body: str = "",
        *,
        status: str = "inbox",
        project: str = "",
        source: str = "",
    ) -> dict:
        clean_title = _clean_title(title)
        status = status.lower()
        if status not in TASK_STATUSES:
            raise InvalidDocument(f"Unsupported task status: {status}")
        metadata = {
            "type": "task",
            "status": status,
            "project": self._metadata_value(project, "project"),
            "source": self._metadata_value(source, "source"),
            "created": self._timestamp(),
            "completed": "",
        }
        document_id = f"{slugify(clean_title)}-{uuid.uuid4().hex[:7]}.md"
        path = self._path_for(document_id)
        self._atomic_write(path, render_task(clean_title, body, metadata))
        return self.get_document(document_id)

    def update_document(
        self,
        document_id: str,
        title: str,
        body: str,
        *,
        expected_revision: str | None = None,
    ) -> dict:
        path = self._path_for(document_id)
        existing = self._read(path)
        self._check_revision(existing, expected_revision)
        content = _render_preserving_frontmatter(title, body, existing.frontmatter_raw)
        self._atomic_write(path, content)
        return self.get_document(document_id)

    def update_note(self, document_id: str, title: str, body: str) -> dict:
        return self.update_document(document_id, title, body)

    def update_task_status(
        self,
        document_id: str,
        status: str,
        *,
        expected_revision: str | None = None,
    ) -> dict:
        status = status.lower()
        if status not in TASK_STATUSES:
            raise InvalidDocument(f"Unsupported task status: {status}")
        path = self._path_for(document_id)
        existing = self._read(path)
        if not existing.is_task:
            raise InvalidDocument("Document is not a task")
        self._check_revision(existing, expected_revision)
        metadata = dict(existing.metadata)
        metadata["status"] = status
        metadata["completed"] = self._timestamp() if status == "done" else ""
        self._atomic_write(path, render_task(existing.title, existing.body, metadata))
        return self.get_document(document_id)

    def complete_task(self, identifier: str) -> dict:
        task = self.resolve_task(identifier)
        return self.update_task_status(task["id"], "done")

    def resolve_task(self, identifier: str) -> dict:
        identifier = identifier.strip()
        if not identifier:
            raise InvalidDocument("Task identifier cannot be empty")
        tasks = self.list_tasks()
        exact = [task for task in tasks if task["id"] == identifier or task["title"].casefold() == identifier.casefold()]
        if len(exact) == 1:
            return exact[0]
        prefix = [task for task in tasks if task["id"].removesuffix(".md").startswith(identifier)]
        if len(prefix) == 1:
            return prefix[0]
        if not exact and not prefix:
            raise FileNotFoundError(identifier)
        raise InvalidDocument("Task identifier is ambiguous")

    def search(self, query: str) -> list[dict]:
        needle = query.strip().casefold()
        if not needle:
            return []
        matches = []
        for document in self._iter_documents():
            haystack = " ".join(
                [document.title, document.body, *document.metadata.values()]
            ).casefold()
            if needle in haystack:
                matches.append(self._summary(document))
        return sorted(matches, key=lambda item: item["modified"], reverse=True)

    def delete_document(self, document_id: str, *, expected_revision: str | None = None) -> None:
        path = self._path_for(document_id)
        existing = self._read(path)
        self._check_revision(existing, expected_revision)
        path.unlink()

    def delete_note(self, document_id: str) -> None:
        self.delete_document(document_id)

    @staticmethod
    def _check_revision(document: Document, expected: str | None) -> None:
        if expected is not None and expected != document.revision:
            raise ConflictError("Document changed outside PlainJot")

    @staticmethod
    def _metadata_value(value: str, field: str) -> str:
        if not isinstance(value, str) or "\n" in value or "\r" in value:
            raise InvalidDocument(f"{field} must be one line of text")
        value = value.strip()
        if len(value) > MAX_METADATA_LENGTH:
            raise InvalidDocument(f"{field} is too long")
        return value

    def _timestamp(self) -> str:
        value = self._clock()
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

    @staticmethod
    def _atomic_write(path: Path, content: str) -> None:
        temporary = path.parent / f".plainjot-{uuid.uuid4().hex}.tmp"
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        descriptor = os.open(temporary, flags, 0o600)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass

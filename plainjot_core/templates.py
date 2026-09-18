"""One small template catalog shared by the CLI and both app backends."""

import json
from pathlib import Path


def list_templates() -> list[dict]:
    return json.loads(Path(__file__).with_name("templates.json").read_text(encoding="utf-8"))


def get_template(identifier: str) -> dict:
    return next(template for template in list_templates() if template["id"] == identifier)

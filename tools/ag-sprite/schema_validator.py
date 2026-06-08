"""Validate atlas JSON against schemas/atlas.schema.json."""

from __future__ import annotations

import json
import logging
from pathlib import Path

import jsonschema

log = logging.getLogger(__name__)

_SCHEMA_PATH = Path(__file__).resolve().parents[2] / "schemas" / "atlas.schema.json"


def _load_schema() -> dict:
    """Load the atlas JSON schema from disk."""
    with open(_SCHEMA_PATH) as f:
        return json.load(f)


def validate_atlas(data: dict) -> list[str]:
    """Validate an atlas dict against atlas.schema.json.

    Returns a list of error messages (empty list = valid).
    """
    schema = _load_schema()
    validator = jsonschema.Draft7Validator(schema)
    errors = sorted(validator.iter_errors(data), key=lambda e: list(e.path))
    messages = []
    for err in errors:
        path = ".".join(str(p) for p in err.absolute_path) or "(root)"
        messages.append(f"{path}: {err.message}")
    return messages


def validate_atlas_file(path: Path) -> list[str]:
    """Convenience: load a JSON file and validate it."""
    with open(path) as f:
        data = json.load(f)
    return validate_atlas(data)

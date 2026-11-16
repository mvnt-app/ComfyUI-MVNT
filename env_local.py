"""Load optional `.env.local` / `.env` in the package root without overriding existing env."""

from __future__ import annotations

import os
from pathlib import Path

_PACKAGE_ROOT = Path(__file__).resolve().parent


def load_package_env_files() -> Path | None:
    """Set unset vars from `.env.local` then `.env`. Returns the file that was loaded."""
    for name in (".env.local", ".env"):
        path = _PACKAGE_ROOT / name
        if not path.is_file():
            continue
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            if not key or key in os.environ:
                continue
            os.environ[key] = value.strip().strip("'\"")
        return path
    return None

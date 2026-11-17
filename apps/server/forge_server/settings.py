"""Paths and settings. Learner data lives outside the repo (never committed)."""
from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
CONTENT_DIR = REPO_ROOT / "content"
PROGRAM_FILE = CONTENT_DIR / "program.yaml"


def data_dir() -> Path:
    """Learner data directory: $FORGE_DATA_DIR or ~/.forge-ml."""
    d = Path(os.environ.get("FORGE_DATA_DIR", Path.home() / ".forge-ml"))
    d.mkdir(parents=True, exist_ok=True)
    (d / "logs").mkdir(exist_ok=True)
    return d


def db_path() -> Path:
    return data_dir() / "forge.sqlite3"

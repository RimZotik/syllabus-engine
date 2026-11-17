"""Paths and settings. Learner data lives outside the repo (never committed).

The platform runs one learning package at a time: a folder `content/<id>/` (see
docs/template/course-package.md). The active one is `active:` in `syllabus.yaml` at the repo
root, or $SYLLABUS_PACKAGE. Every package keeps its own learner database.
"""
from __future__ import annotations

import os
import re
import sqlite3
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
CONTENT_ROOT = REPO_ROOT / "content"
CONFIG_FILE = REPO_ROOT / "syllabus.yaml"

# Before packages existed, Forge ML progress lived here. It is copied (never moved) on first start.
LEGACY_DB = {"forge-ml": Path.home() / ".forge-ml" / "forge.sqlite3"}


class PackageError(RuntimeError):
    pass


def _env(name: str) -> str | None:
    """SYLLABUS_* variables; the older FORGE_* names still work."""
    return os.environ.get(f"SYLLABUS_{name}") or os.environ.get(f"FORGE_{name}")


def active_package() -> str:
    pkg = os.environ.get("SYLLABUS_PACKAGE")
    if not pkg:
        m = re.search(r"^active:\s*([\w.-]+)", CONFIG_FILE.read_text(encoding="utf-8"), re.M) if CONFIG_FILE.exists() else None
        if not m:
            raise PackageError(f"не выбрано обучение: укажите active: <папка> в {CONFIG_FILE.name}")
        pkg = m.group(1)
    if not (CONTENT_ROOT / pkg / "package.yaml").is_file():
        raise PackageError(f"пакет обучения content/{pkg}/ не найден (нет package.yaml)")
    return pkg


def package_dir(pkg: str | None = None) -> Path:
    return CONTENT_ROOT / (pkg or active_package())


def program_file(pkg: str | None = None) -> Path:
    return package_dir(pkg) / "program.yaml"


def data_dir() -> Path:
    """Learner data directory: $SYLLABUS_DATA_DIR (or the older $FORGE_DATA_DIR), default ~/.syllabus-engine."""
    d = Path(_env("DATA_DIR") or Path.home() / ".syllabus-engine")
    d.mkdir(parents=True, exist_ok=True)
    (d / "logs").mkdir(exist_ok=True)
    return d


def db_path(pkg: str | None = None) -> Path:
    """One database per learning package: <data_dir>/<package>.sqlite3."""
    pkg = pkg or active_package()
    path = data_dir() / f"{pkg}.sqlite3"
    legacy = LEGACY_DB.get(pkg)
    if not path.exists() and legacy and legacy.exists() and not _env("DATA_DIR"):
        copy_db(legacy, path)
    return path


def copy_db(src: Path, dst: Path) -> None:
    """Consistent copy of a live SQLite database (WAL included); the source stays untouched."""
    with sqlite3.connect(src) as s, sqlite3.connect(dst) as d:
        s.backup(d)

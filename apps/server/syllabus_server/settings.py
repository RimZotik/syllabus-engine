"""Paths and settings. Learner data lives outside the repo (never committed).

Every folder `courses/<id>/` with a package.yaml is an installed learning package (see
docs/template/course-package.md); the platform serves all of them, each with its own learner
database. Which one a request is about comes from the URL of the page (the web app sends it in the
X-Syllabus-Package header). `active:` in `courses/active.yaml` (or $SYLLABUS_PACKAGE) is the default:
the package opened when nothing else is said — the only one when a single package is installed.
"""
from __future__ import annotations

import os
import re
import sqlite3
from contextlib import closing
from contextvars import ContextVar
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
# A packaged app (tools/bundle) carries its courses inside and says where they are.
CONTENT_ROOT = Path(os.environ["SYLLABUS_CONTENT_ROOT"]) if os.environ.get("SYLLABUS_CONTENT_ROOT") else REPO_ROOT / "courses"
CONFIG_FILE = CONTENT_ROOT / "active.yaml"

# Before packages existed, Forge ML progress lived here. It is copied (never moved) on first start.
LEGACY_DB = {"ml-bigdata-ai": Path.home() / ".forge-ml" / "forge.sqlite3"}


# A package id is a plain folder name (it also names the learner database), never a path.
PACKAGE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]*")
# `active: <id>` in courses/active.yaml; the value may be quoted.
ACTIVE_LINE = re.compile(r"""^active:[ \t]*["']?([A-Za-z0-9_.-]+)""", re.M)


class PackageError(RuntimeError):
    pass


def _env(name: str) -> str | None:
    """SYLLABUS_* variables; the older FORGE_* names still work."""
    return os.environ.get(f"SYLLABUS_{name}") or os.environ.get(f"FORGE_{name}")


def active_package() -> str:
    pkg = os.environ.get("SYLLABUS_PACKAGE")
    if not pkg:
        m = ACTIVE_LINE.search(CONFIG_FILE.read_text(encoding="utf-8")) if CONFIG_FILE.exists() else None
        if not m:
            raise PackageError(f"не выбрано обучение: укажите active: <папка> в courses/{CONFIG_FILE.name}")
        pkg = m.group(1)
    if not PACKAGE_ID.fullmatch(pkg):
        raise PackageError(f"недопустимое имя пакета обучения {pkg!r}: только латиница, цифры, '-', '_', '.'")
    if not (CONTENT_ROOT / pkg / "package.yaml").is_file():
        raise PackageError(f"обучение courses/{pkg}/ не найдено (нет package.yaml)")
    return pkg


def installed_packages() -> list[str]:
    """Ids of every installed package: folders of courses/ with a package.yaml and a valid name."""
    if not CONTENT_ROOT.is_dir():
        return []
    return sorted(p.name for p in CONTENT_ROOT.iterdir()
                  if p.is_dir() and PACKAGE_ID.fullmatch(p.name) and (p / "package.yaml").is_file())


# The package the current request is about (set by the API middleware from the X-Syllabus-Package header).
_current: ContextVar[str | None] = ContextVar("syllabus_package", default=None)


def use_package(pkg: str | None):
    """Make `pkg` the package of the current request; returns a token for `_current.reset`."""
    return _current.set(pkg)


def current_package() -> str:
    return _current.get() or active_package()


def package_dir(pkg: str | None = None) -> Path:
    return CONTENT_ROOT / (pkg or current_package())


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
    pkg = pkg or current_package()
    path = data_dir() / f"{pkg}.sqlite3"
    legacy = LEGACY_DB.get(pkg)
    if not path.exists() and legacy and legacy.exists() and not _env("DATA_DIR"):
        copy_db(legacy, path)
    return path


def copy_db(src: Path, dst: Path) -> None:
    """Consistent copy of a live SQLite database (WAL included); the source stays untouched.

    The copy is written to a temporary file and renamed into place only when complete, so an
    interrupted copy never leaves a half-written `dst` that would block the next attempt."""
    tmp = dst.with_name(f"{dst.name}.copy-{os.getpid()}.tmp")
    try:
        with closing(sqlite3.connect(src)) as s, closing(sqlite3.connect(tmp)) as d:
            s.backup(d)
        os.replace(tmp, dst)
    finally:
        tmp.unlink(missing_ok=True)

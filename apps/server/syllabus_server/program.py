"""Read the active learning package (package.yaml + program.yaml) and shape it for the UI."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml

from .settings import PackageError, current_package, package_dir, program_file

ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]


@lru_cache(maxsize=4)
def _load(path: str, mtime: float) -> dict:
    return yaml.safe_load(Path(path).read_text(encoding="utf-8"))


def _read(path: Path) -> dict:
    if not path.is_file():
        raise PackageError(f"нет файла {path.relative_to(path.parents[2]) if len(path.parents) > 2 else path}")
    return _load(str(path), path.stat().st_mtime) or {}


def load_package(pkg: str | None = None) -> dict:
    """Passport of the learning package with defaults filled in (format: docs/template/course-package.md)."""
    pkg = pkg or current_package()
    raw = _read(package_dir(pkg) / "package.yaml")
    landing = raw.get("landing") or {}
    author = raw.get("author") or {}
    if isinstance(author, str):
        author = {"name": author}
    return {
        "id": pkg,
        "title": raw.get("title") or pkg,
        "language": raw.get("language", "ru"),
        "summary": raw.get("summary", ""),
        # catalog card: everything optional
        "icon": raw.get("icon") or "book-open",
        "color": raw.get("color") or "green",
        "subtitle": raw.get("subtitle", ""),
        "level": raw.get("level", ""),
        "version": str(raw.get("version") or ""),
        "author": {"name": author.get("name", ""), "url": author.get("url", "")},
        "tags": list(raw.get("tags") or []),
        "license": raw.get("license", ""),
        "landing": {
            "headline": landing.get("headline") or raw.get("title") or pkg,
            "lead": landing.get("lead") or raw.get("summary", ""),
            "cta": landing.get("cta") or "Начать",
            "subjects_lead": landing.get("subjects_lead", ""),
            "highlight_subject": landing.get("highlight_subject"),
        },
        "teacher": {"course": (raw.get("teacher") or {}).get("course") or raw.get("title") or pkg},
        "rules": raw.get("rules") or {},
    }


def load_program(path: Path | None = None) -> dict:
    """Parsed program of the current package; re-read automatically when the file changes."""
    raw = _read(path or program_file())
    subjects = {s["id"]: s["title"] for s in raw["subjects"]}
    max_level: dict[str, int] = {}
    for c in raw["courses"]:
        for d in c["disciplines"]:
            max_level[d["subject"]] = max(max_level.get(d["subject"], 0), d["level"])

    courses = []
    for c in raw["courses"]:
        discs = []
        for d in c["disciplines"]:
            name = subjects[d["subject"]] + ("" if max_level[d["subject"]] == 1 else f" {ROMAN[d['level']]}")
            sections = [
                {
                    "id": s["id"],
                    "title": s["title"],
                    "topics": [{"id": f"{s['id']}.{i}", "title": t} for i, t in enumerate(s["topics"], 1)],
                }
                for s in d["sections"]
            ]
            levels = [
                {"level": x["level"], "title": x["title"], "course": cc["id"]}
                for cc in raw["courses"] for x in cc["disciplines"] if x["subject"] == d["subject"]
            ]
            discs.append({
                "id": d["id"], "subject": d["subject"], "subjectTitle": subjects[d["subject"]], "level": d["level"],
                "name": name, "title": d["title"], "hours": d["hours"], "summary": d["summary"],
                "unlocks": d.get("unlocks", []), "levels": levels if len(levels) > 1 else [], "sections": sections,
            })
        courses.append({
            "id": c["id"], "title": c["title"], "tagline": c["tagline"], "project": c.get("project"),
            "hours": sum(d["hours"] for d in c["disciplines"]), "disciplines": discs,
        })
    levels = [{"id": x["id"], "title": x["title"], "gate": x.get("gate", "")} for x in (raw["program"].get("levels") or [])]
    return {"title": raw["program"]["title"], "levels": levels, "courses": courses}


def topic_ids(program: dict) -> list[str]:
    return [t["id"] for c in program["courses"] for d in c["disciplines"] for s in d["sections"] for t in s["topics"]]

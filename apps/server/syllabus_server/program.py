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
        # strict: topics open in program order; free: everything is open (a group led by its teacher)
        "order": raw.get("order") if raw.get("order") in ("strict", "free") else "strict",
        # who the course is for: what to know before it, and what is taught from zero
        "prerequisites": list((raw.get("prerequisites") or {}).get("know") or []),
        "not_required": list((raw.get("prerequisites") or {}).get("not_needed") or []),
        "license": raw.get("license", ""),
        "landing": {
            "headline": landing.get("headline") or raw.get("title") or pkg,
            "lead": landing.get("lead") or raw.get("summary", ""),
            "cta": landing.get("cta") or "Начать",
            "subjects_lead": landing.get("subjects_lead", ""),
            "highlight_subject": landing.get("highlight_subject"),
        },
        # the teacher (Claude) differs by subject: an engineer for programmers, an art historian for painters
        "teacher": {
            "course": (raw.get("teacher") or {}).get("course") or raw.get("title") or pkg,
            "role": (raw.get("teacher") or {}).get("role", ""),
            "style": (raw.get("teacher") or {}).get("style", ""),
        },
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
            "id": c["id"], "title": c["title"], "tagline": c["tagline"], "project": c.get("project"), "intro": bool(c.get("intro")),
            "hours": sum(d["hours"] for d in c["disciplines"]), "disciplines": discs,
        })
    levels = [{"id": x["id"], "title": x["title"], "gate": x.get("gate", "")} for x in (raw["program"].get("levels") or [])]
    return {"title": raw["program"]["title"], "levels": levels, "courses": courses}


def topic_ids(program: dict) -> list[str]:
    return [t["id"] for c in program["courses"] for d in c["disciplines"] for s in d["sections"] for t in s["topics"]]


def check_context(program: dict, scope: str) -> dict:
    """Where a checked question lives, so the teacher can match its demands to the level:
    a topic quiz (scope = topic id), a section test (section id) or a discipline exam (discipline id)."""
    courses = program["courses"]
    for ci, c in enumerate(courses, 1):
        for d in c["disciplines"]:
            base = {"course": c["title"], "course_no": ci, "intro": c.get("intro", False), "courses_total": len(courses), "course_tagline": c.get("tagline", ""),
                    "discipline": d["title"], "discipline_summary": d.get("summary", "")}
            if d["id"] == scope:
                return base | {"kind": "exam"}
            for s in d["sections"]:
                if s["id"] == scope:
                    return base | {"kind": "section_test", "section": s["title"], "topics": [t["title"] for t in s["topics"]]}
                for t in s["topics"]:
                    if t["id"] == scope:
                        return base | {"kind": "topic_quiz", "section": s["title"], "topic": t["title"]}
    return {}


def _topic_files(pkg_dir: Path, section_id: str) -> list[Path]:
    """topic.mdx files of a section, in topic order (lessons/<discipline>/<section>/<NN-slug>/topic.mdx)."""
    disc, _, sec = section_id.partition(".")
    return sorted((pkg_dir / "lessons" / disc / sec).glob("*/topic.mdx"))


def _plain(mdx: str) -> str:
    """Lesson text without the export block, JSX tags and blank runs — what the learner reads, in short."""
    import re
    text = re.sub(r"^export const meta = \{.*?\n\};?\s*$", "", mdx, flags=re.S | re.M)
    text = re.sub(r"<[A-Z][^>]*?/>", "", text, flags=re.S)       # self-closing components
    text = re.sub(r"</?[A-Z][^>]*>", "", text)                     # component open/close tags
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _gist(mdx: str) -> str:
    """Lead, highlighted ideas and summary of one topic."""
    import re
    lead = re.search(r'lead:\s*"(.*?)"', mdx)
    marks = re.findall(r"<Mark>(.*?)</Mark>", mdx, flags=re.S)
    summary = re.search(r"<Summary items=\{\[(.*?)\]\}", mdx, flags=re.S)
    items = re.findall(r'"((?:[^"\\]|\\.)*)"', summary.group(1)) if summary else []
    return "\n".join([lead.group(1) if lead else "", *[f"• {m.strip()}" for m in marks], *[f"– {i}" for i in items]]).strip()


def lesson_material(pkg_dir: Path, ctx: dict, scope: str, limit: int = 14000) -> str:
    """What the learner has read for this check: the whole topic for a topic quiz, the gist of every topic for a section test."""
    try:
        if ctx.get("kind") == "topic_quiz":
            section, _, n = scope.rpartition(".")
            files = _topic_files(pkg_dir, section)
            if len(files) < int(n):
                return ""
            mdx = files[int(n) - 1].read_text(encoding="utf-8")
            return f"Итог темы:\n{_gist(mdx)}\n\nТекст темы:\n{_plain(mdx)}"[:limit]  # summary first: it survives the cut
        if ctx.get("kind") == "section_test":
            return "\n\n".join(_gist(f.read_text(encoding="utf-8")) for f in _topic_files(pkg_dir, scope))[:limit]
    except (OSError, ValueError):
        return ""
    return ""

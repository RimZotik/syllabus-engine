"""Validate content/program.yaml and generate docs/content/curriculum.md.

Checks:
  * ids are unique;
  * every `requires` points to a section defined EARLIER (no forward dependencies);
  * every `used_by` points to a section defined LATER (fundamentals must be used downstream);
  * every math section (math1/linalg/calc/prob/stats) declares `used_by` — no math "just because".

Run: uv run --with pyyaml tools/program/build.py [--check]
"""
from __future__ import annotations

import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "content" / "program.yaml"
OUT = ROOT / "docs" / "content" / "curriculum.md"
MATH = {"math1", "linalg", "calc", "prob", "stats"}


def load() -> dict:
    return yaml.safe_load(SRC.read_text(encoding="utf-8"))


def validate(data: dict) -> list[str]:
    errors: list[str] = []
    order: dict[str, int] = {}
    sections: list[tuple[str, dict, str]] = []
    for course in data["courses"]:
        for disc in course["disciplines"]:
            for sec in disc["sections"]:
                sid = sec["id"]
                if sid in order:
                    errors.append(f"duplicate id: {sid}")
                order[sid] = len(order)
                sections.append((sid, sec, disc["id"]))
    for sid, sec, disc_id in sections:
        for req in sec.get("requires", []) or []:
            if req not in order:
                errors.append(f"{sid}: requires unknown {req}")
            elif order[req] >= order[sid]:
                errors.append(f"{sid}: requires {req}, which comes later")
        for use in sec.get("used_by", []) or []:
            if use not in order:
                errors.append(f"{sid}: used_by unknown {use}")
            elif order[use] <= order[sid]:
                errors.append(f"{sid}: used_by {use}, which comes earlier")
        if disc_id in MATH and not sec.get("used_by") and not sid.endswith("_unlock"):
            errors.append(f"{sid}: math section without used_by")
    return errors


def render(data: dict) -> str:
    titles = {}
    for c in data["courses"]:
        for d in c["disciplines"]:
            for s in d["sections"]:
                titles[s["id"]] = s["title"]

    total = sum(d["hours"] for c in data["courses"] for d in c["disciplines"])
    n_sec = len(titles)
    n_top = sum(len(s["topics"]) for c in data["courses"] for d in c["disciplines"] for s in d["sections"])
    lines = [
        "# 02. Учебный план",
        "",
        "> **Файл сгенерирован** из `content/program.yaml` скриптом `tools/program/build.py` — правьте YAML, не этот файл.",
        f"> Объём: {len(data['courses'])} курсов, {sum(len(c['disciplines']) for c in data['courses'])} дисциплин, "
        f"разделов: {n_sec}, тем: {n_top}; около {total} ч учёбы + курсовые проекты (~30 ч каждый).",
        "",
        "## Иерархия",
        "",
        "| Уровень | Чем заканчивается |",
        "|---|---|",
    ]
    for lvl in data["program"]["levels"]:
        lines.append(f"| {lvl['title']} | {lvl['gate']} |")
    lines += [
        "",
        f"Дополнительно: {data['program']['residual_check']}.",
        "",
        "Правила порядка: дисциплины внутри курса идут **строго последовательно**, без чередования. "
        "Одна и та же область может вернуться в следующем курсе на более высоком уровне (Python I → Python II, SQL I → SQL II). "
        "Библиотека «открывается» только после сдачи дисциплины, где ученик реализовал её идею сам.",
        "",
        "## Обзор",
        "",
        "| Курс | Дисциплины | Часы | Открываемые библиотеки |",
        "|---|---|---|---|",
    ]
    for c in data["courses"]:
        hours = sum(d["hours"] for d in c["disciplines"])
        discs = " → ".join(d["title"] for d in c["disciplines"])
        libs = ", ".join(lib for d in c["disciplines"] for lib in d.get("unlocks", [])) or "—"
        lines.append(f"| **{c['id']}. {c['title']}** | {discs} | {hours} | {libs} |")
    lines.append(f"| **{data['graduation']['title']}** | " + "; ".join(data["graduation"]["parts"]) + " | | |")

    for c in data["courses"]:
        hours = sum(d["hours"] for d in c["disciplines"])
        lines += ["", "---", "", f"## Курс {c['id']}. {c['title']} · {hours} ч", "", f"*{c['tagline']}*", ""]
        for di, d in enumerate(c["disciplines"], 1):
            unlock = f" · открывает: {', '.join(d['unlocks'])}" if d.get("unlocks") else ""
            lines += ["", f"### {c['id']}.{di}. {d['title']} · {d['hours']} ч{unlock}", ""]
            for si, s in enumerate(d["sections"], 1):
                lines.append(f"**{di}.{si}. {s['title']}**")
                if s.get("why"):
                    lines.append(f"<br>*Зачем:* {s['why']}")
                ext = [r for r in s.get("requires", []) or [] if r.split(".")[0] != d["id"]]
                if ext:
                    lines.append("<br>*Опирается на:* " + ", ".join(titles[r] for r in ext))
                if s.get("used_by"):
                    lines.append("<br>*Пригодится в:* " + ", ".join(titles[u] for u in s["used_by"]))
                lines.append("")
                for ti, t in enumerate(s["topics"], 1):
                    lines.append(f"{ti}. {t}")
                lines.append("")
        lines += [f"**Курсовой проект.** {c['project']}", ""]
    lines += ["---", "", f"## {data['graduation']['title']}", ""]
    lines += [f"- {p}" for p in data["graduation"]["parts"]]
    return "\n".join(lines) + "\n"


def main() -> int:
    data = load()
    errors = validate(data)
    if errors:
        print("program.yaml: FAILED", file=sys.stderr)
        for e in errors:
            print("  -", e, file=sys.stderr)
        return 1
    text = render(data)
    if "--check" in sys.argv:
        if OUT.read_text(encoding="utf-8") != text:
            print("docs/content/curriculum.md is stale", file=sys.stderr)
            return 1
    else:
        OUT.write_text(text, encoding="utf-8", newline="\n")
    print("program.yaml: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())

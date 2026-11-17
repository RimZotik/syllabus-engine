"""Validate content/program.yaml and generate the curriculum documents.

Checks:
  * ids are unique; every discipline references a known subject;
  * subject levels go 1, 2, 3... in order of appearance (a level never repeats or skips);
  * Algorithms (algo) has a level in every course I–VI;
  * every `requires` points to a section defined EARLIER (no forward dependencies);
  * every `used_by` points to a section defined LATER;
  * every section of a math subject declares `used_by` — no math "just because".

Outputs:
  docs/content/curriculum.md      — the full plan for people
  docs/dev/prerequisite-trees.md  — what each key topic transitively rests on (for authors and reviewers)

Run: uv run --with pyyaml tools/program/build.py [--check]
"""
from __future__ import annotations

import re
import sys
from collections import defaultdict
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "content" / "program.yaml"
OUT = ROOT / "docs" / "content" / "curriculum.md"
TREES = ROOT / "docs" / "dev" / "prerequisite-trees.md"
README = ROOT / "README.md"
COURSES = ROOT / "content" / "courses"
GLOSSARY = ROOT / "content" / "glossary.yaml"
ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]


def load() -> dict:
    return yaml.safe_load(SRC.read_text(encoding="utf-8"))


def index(data: dict):
    """Flatten the plan: ordered sections with their discipline and course."""
    sections, disc_of, course_of, order = [], {}, {}, {}
    for course in data["courses"]:
        for disc in course["disciplines"]:
            for sec in disc["sections"]:
                order.setdefault(sec["id"], len(order))
                sections.append(sec)
                disc_of[sec["id"]] = disc
                course_of[sec["id"]] = course
    return sections, disc_of, course_of, order


def disc_name(data: dict, disc: dict) -> str:
    subj = {s["id"]: s["title"] for s in data["subjects"]}[disc["subject"]]
    levels = [d["level"] for c in data["courses"] for d in c["disciplines"] if d["subject"] == disc["subject"]]
    if max(levels) == 1:
        return subj
    return f"{subj} {ROMAN[disc['level']]}"


def validate(data: dict) -> list[str]:
    errors: list[str] = []
    subjects = {s["id"] for s in data["subjects"]}
    math = set(data.get("math_subjects", []))
    sections, disc_of, course_of, order = index(data)

    seen = set()
    for s in sections:
        if s["id"] in seen:
            errors.append(f"duplicate section id: {s['id']}")
        seen.add(s["id"])

    last_level: dict[str, int] = defaultdict(int)
    for course in data["courses"]:
        for disc in course["disciplines"]:
            if disc["subject"] not in subjects:
                errors.append(f"{disc['id']}: unknown subject {disc['subject']}")
            lvl = disc.get("level")
            if lvl != last_level[disc["subject"]] + 1:
                errors.append(f"{disc['id']}: level {lvl} after level {last_level[disc['subject']]} of {disc['subject']}")
            last_level[disc["subject"]] = lvl or 0
            if not disc.get("summary"):
                errors.append(f"{disc['id']}: missing summary")
    for course in data["courses"]:
        if course["id"] != "0" and not any(d["subject"] == "algo" for d in course["disciplines"]):
            errors.append(f"course {course['id']}: no Algorithms level")

    for s in sections:
        sid = s["id"]
        for t in s.get("topics", []):
            if not isinstance(t, str):
                errors.append(f"{sid}: topic is not a plain string (quote it if it contains ': '): {t!r}")
        for req in s.get("requires", []) or []:
            if req not in order:
                errors.append(f"{sid}: requires unknown {req}")
            elif order[req] >= order[sid]:
                errors.append(f"{sid}: requires {req}, which comes later")
        for use in s.get("used_by", []) or []:
            if use not in order:
                errors.append(f"{sid}: used_by unknown {use}")
            elif order[use] <= order[sid]:
                errors.append(f"{sid}: used_by {use}, which comes earlier")
        req_map = {x["id"]: list(x.get("requires", []) or []) for x in sections}
        for use in s.get("used_by", []) or []:
            if use in order and sid not in closure(use, req_map):
                errors.append(f"{sid}: used_by {use}, but {use} does not depend on it via requires")
        if disc_of[sid]["subject"] in math and not s.get("used_by") and not sid.endswith("_unlock"):
            errors.append(f"{sid}: math section without used_by")
    return errors


def closure(sid: str, req: dict[str, list[str]]) -> set[str]:
    out, stack = set(), list(req.get(sid, []))
    while stack:
        x = stack.pop()
        if x not in out:
            out.add(x)
            stack.extend(req.get(x, []))
    return out


def plural(n: int, one: str, few: str, many: str) -> str:
    if n % 10 == 1 and n % 100 != 11:
        return one
    if n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14):
        return few
    return many


def render_curriculum(data: dict) -> str:
    sections, disc_of, course_of, order = index(data)
    titles = {s["id"]: s["title"] for s in sections}
    discs = [d for c in data["courses"] for d in c["disciplines"]]
    total = sum(d["hours"] for d in discs)
    n_top = sum(len(s["topics"]) for s in sections)
    L = [
        "# Учебный план",
        "",
        "> **Файл сгенерирован** из `content/program.yaml` скриптом `tools/program/build.py` — правьте YAML, не этот файл.",
        "> " + ", ".join(f"{n} {plural(n, *w)}" for n, w in [
            (len(data['courses']), ("курс", "курса", "курсов")), (len(data['subjects']), ("предмет", "предмета", "предметов")),
            (len(discs), ("дисциплина", "дисциплины", "дисциплин")), (len(sections), ("раздел", "раздела", "разделов")),
            (n_top, ("тема", "темы", "тем"))]) + f"; около {total} ч учёбы + курсовые проекты (~30 ч каждый).",
        "",
        "## Как устроено",
        "",
        "- **Предмет** — сквозная линия (Программирование, Алгоритмы, Линейная алгебра…). У предмета есть уровни: I, II, III…",
        "- **Дисциплина** — один уровень предмета на конкретном курсе («Программирование III»). Уровень растёт, когда в предмете появляются новые темы; повторение уровень не повышает.",
        "- Внутри курса дисциплины идут строго друг за другом, без чередования.",
        f"- Рубежи: " + "; ".join(f"{l['title'].lower()} — {l['gate'][0].lower()}{l['gate'][1:]}" for l in data["program"]["levels"]) + ".",
        f"- Дополнительно: {data['program']['residual_check']}.",
        "- Библиотека «открывается» только после того, как её идея реализована своими руками.",
        "",
        "## Предметы по курсам",
        "",
    ]
    course_ids = [c["id"] for c in data["courses"]]
    L.append("| Предмет | " + " | ".join(f"Курс {c}" for c in course_ids) + " |")
    L.append("|---|" + "---|" * len(course_ids))
    for subj in data["subjects"]:
        cells = []
        for c in data["courses"]:
            lv = [d for d in c["disciplines"] if d["subject"] == subj["id"]]
            single = max([d["level"] for cc in data["courses"] for d in cc["disciplines"] if d["subject"] == subj["id"]]) == 1
            cells.append(", ".join("•" if single else ROMAN[d["level"]] for d in lv))
        L.append(f"| {subj['title']} | " + " | ".join(cells) + " |")

    for c in data["courses"]:
        hours = sum(d["hours"] for d in c["disciplines"])
        L += ["", "---", "", f"## Курс {c['id']}. {c['title']} · {hours} ч", "", f"*{c['tagline']}*", ""]
        L.append("| # | Дисциплина | Часы | Что вас ждёт |")
        L.append("|---|---|---|---|")
        for i, d in enumerate(c["disciplines"], 1):
            L.append(f"| {i} | **{disc_name(data, d)}**" + (f" — {d['title']}" if d['title'] != disc_name(data, d) else "") + f" | {d['hours']} | {d['summary']} |")
        for i, d in enumerate(c["disciplines"], 1):
            unlock = f" · открывает: {', '.join(d['unlocks'])}" if d.get("unlocks") else ""
            L += ["", f"### {c['id']}.{i}. {disc_name(data, d)}" + (f" — {d['title']}" if d['title'] != disc_name(data, d) else "") + f" · {d['hours']} ч{unlock}", ""]
            prev = [x for cc in data["courses"] for x in cc["disciplines"] if x["subject"] == d["subject"] and x["level"] == d["level"] - 1]
            intro = (f"что изменилось после уровня {ROMAN[d['level'] - 1]} ({prev[0]['title']}) и зачем идём дальше" if prev
                     else "что это за предмет, зачем он нужен в профессии и как до него додумались — через историю проблемы и её решения")
            L += [f"**0. Вводная лекция** — {intro}", ""]
            for si, s in enumerate(d["sections"], 1):
                L.append(f"**{si}. {s['title']}**")
                if s.get("why"):
                    L.append(f"<br>*Зачем:* {s['why']}")
                ext = [r for r in s.get("requires", []) or [] if disc_of[r]["id"] != d["id"]]
                if ext:
                    L.append("<br>*Опирается на:* " + ", ".join(f"{titles[r]} ({disc_name(data, disc_of[r])})" for r in ext))
                if s.get("used_by"):
                    L.append("<br>*Пригодится в:* " + ", ".join(f"{titles[u]} ({disc_name(data, disc_of[u])})" for u in s["used_by"]))
                L.append("")
                L += [f"{ti}. {t}" for ti, t in enumerate(s["topics"], 1)]
                L.append("")
        if c.get("project"):
            L += [f"**Курсовой проект.** {c['project']}", ""]
    L += ["---", "", f"## {data['graduation']['title']}", ""] + [f"- {p}" for p in data["graduation"]["parts"]]
    return "\n".join(L) + "\n"


def render_trees(data: dict) -> str:
    sections, disc_of, course_of, order = index(data)
    titles = {s["id"]: s["title"] for s in sections}
    req = {s["id"]: list(s.get("requires", []) or []) for s in sections}
    L = [
        "# Деревья предпосылок",
        "",
        "> Сгенерировано `tools/program/build.py`. Для каждой ключевой темы — всё, на что она опирается (транзитивно),",
        "> сгруппировано по предметам в порядке прохождения. Используется авторами и ревьюерами, чтобы проверить:",
        "> к моменту темы всё нужное уже пройдено, и ничего лишнего в цепочке нет.",
        "",
    ]
    subj_order = [s["id"] for s in data["subjects"]]
    for target in data.get("trees", []):
        deps = closure(target, req)
        d = disc_of[target]
        L += [f"## {titles[target]} — {disc_name(data, d)}, курс {course_of[target]['id']}", ""]
        L.append(f"Опирается на {len(deps)} {plural(len(deps), 'раздел', 'раздела', 'разделов')}:")
        L.append("")
        by_subj = defaultdict(list)
        for x in deps:
            by_subj[disc_of[x]["subject"]].append(x)
        for subj in subj_order:
            if subj in by_subj:
                items = sorted(by_subj[subj], key=order.get)
                name = {s["id"]: s["title"] for s in data["subjects"]}[subj]
                L.append(f"- **{name}:** " + " → ".join(f"{titles[x]} ({ROMAN[disc_of[x]['level']] if subj != 'intro' else ''})".replace(" ()", "") for x in items))
        L.append("")
    # sections nothing later depends on (outside the final course) — candidates to review
    used = {r for rs in req.values() for r in rs}
    last_course = data["courses"][-1]["id"]
    dangling = [s["id"] for s in sections if s["id"] not in used and course_of[s["id"]]["id"] != last_course]
    L += ["## Разделы, на которые ничто не опирается явно", "",
          "Это не ошибка, а список для проверки: либо добавить явную связь, либо убедиться, что раздел нужен сам по себе.", ""]
    L += [f"- {titles[x]} ({disc_name(data, disc_of[x])})" for x in dangling]
    return "\n".join(L) + "\n"


def check_content(data: dict) -> tuple[list[str], set[str]]:
    """Authored topics must exist in the plan; glossary terms must exist; quiz answers must be valid."""
    errors: list[str] = []
    sections, *_ = index(data)
    topic_ids = {f"{s['id']}.{i}" for s in sections for i in range(1, len(s["topics"]) + 1)}
    section_ids = {s["id"] for s in sections}
    glossary = {t["id"] for t in yaml.safe_load(GLOSSARY.read_text(encoding="utf-8"))} if GLOSSARY.exists() else set()
    authored: set[str] = set()
    for mdx in sorted(COURSES.glob("*/*/*/*/topic.mdx")):
        _, disc, sec, folder = mdx.relative_to(COURSES).parts[:4]
        tid = f"{disc}.{sec}.{int(folder.split('-')[0])}"
        if tid not in topic_ids:
            errors.append(f"{mdx.relative_to(ROOT)}: topic {tid} is not in program.yaml")
        authored.add(tid)
        for term_id in re.findall(r'<Term id="([^"]+)"', mdx.read_text(encoding="utf-8")):
            if term_id not in glossary:
                errors.append(f"{mdx.relative_to(ROOT)}: term '{term_id}' missing in glossary.yaml")
    for qf in sorted(list(COURSES.glob("*/*/*/*/quiz.yaml")) + list(COURSES.glob("*/*/*/test.yaml"))):
        quiz = yaml.safe_load(qf.read_text(encoding="utf-8"))
        if qf.name == "test.yaml":
            _, disc, sec = qf.relative_to(COURSES).parts[:3]
            if f"{disc}.{sec}" not in section_ids:
                errors.append(f"{qf.relative_to(ROOT)}: section {disc}.{sec} is not in program.yaml")
        ids = set()
        for q in quiz.get("questions", []):
            where = f"{qf.relative_to(ROOT)}:{q.get('id')}"
            if q["id"] in ids:
                errors.append(f"{where}: duplicate question id")
            ids.add(q["id"])
            if q["type"] in ("single", "multi"):
                n = len(q.get("options", []))
                ans = q.get("answer")
                ans = ans if isinstance(ans, list) else [ans]
                if q["type"] == "single" and len(ans) != 1:
                    errors.append(f"{where}: single-choice needs one answer")
                if not ans or any(not isinstance(a, int) or not 0 <= a < n for a in ans):
                    errors.append(f"{where}: answer index out of range")
            elif q["type"] == "open" and not q.get("rubric"):
                errors.append(f"{where}: open question needs a rubric for the teacher")
    return errors, authored


def render_progress(data: dict, authored: set[str]) -> str:
    sections, *_ = index(data)
    total = sum(len(s["topics"]) for s in sections)
    pct = 100 * len(authored) / total if total else 0
    per_course = []
    for c in data["courses"]:
        ids = [f"{s['id']}.{i}" for d in c["disciplines"] for s in d["sections"] for i in range(1, len(s["topics"]) + 1)]
        done = len([i for i in ids if i in authored])
        per_course.append(f"| Курс {c['id']}. {c['title']} | {done} / {len(ids)} |")
    return "\n".join([
        "<!-- progress:start -->",
        f"**Готовность учебных материалов: {pct:.1f} %** — написано тем: {len(authored)} из {total}.",
        "",
        "| Курс | Темы |",
        "|---|---|",
        *per_course,
        "<!-- progress:end -->",
    ])


def main() -> int:
    data = load()
    errors = validate(data)
    content_errors, authored = check_content(data)
    errors += content_errors
    if errors:
        print("program.yaml: FAILED", file=sys.stderr)
        for e in errors:
            print("  -", e, file=sys.stderr)
        return 1
    outputs = {OUT: render_curriculum(data), TREES: render_trees(data)}
    readme = README.read_text(encoding="utf-8")
    if "<!-- progress:start -->" in readme:
        head, rest = readme.split("<!-- progress:start -->", 1)
        tail = rest.split("<!-- progress:end -->", 1)[1]
        outputs[README] = head + render_progress(data, authored) + tail
    if "--check" in sys.argv:
        stale = [str(p.relative_to(ROOT)) for p, text in outputs.items() if not p.exists() or p.read_text(encoding="utf-8") != text]
        if stale:
            print("stale generated files: " + ", ".join(stale), file=sys.stderr)
            return 1
    else:
        for p, text in outputs.items():
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text, encoding="utf-8", newline="\n")
    print("program.yaml: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())

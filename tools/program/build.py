"""Validate a learning package (courses/<id>/) and generate its curriculum documents.

Checks:
  * package.yaml exists, its id matches the folder, title is set;
  * ids are unique; every discipline references a known subject;
  * subject levels go 1, 2, 3... in order of appearance (a level never repeats or skips);
  * package rules from package.yaml, e.g. `every_course_has: {subject: algo, except: ["0"]}`, `glossary_en: true` (every term has `en`);
  * every `requires` points to a section defined EARLIER (no forward dependencies);
  * every `used_by` points to a section defined LATER;
  * every section of a math subject declares `used_by` — no math "just because".

Outputs (inside the package):
  docs/curriculum.md          — the full plan for people
  docs/prerequisite-trees.md  — what each key topic transitively rests on (for authors and reviewers)
and the progress block of the root README for the active package.

Run: uv run --with pyyaml tools/program/build.py [--check] [--package <id> | --all]
  default package — `active:` in courses/active.yaml (or $SYLLABUS_PACKAGE)
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
CONTENT_ROOT = ROOT / "courses"
README = ROOT / "README.md"
# Paths of the package being checked — set by use_package().
PKG = PKG_DIR = SRC = OUT = TREES = COURSES = GLOSSARY = None  # type: ignore[assignment]
META: dict = {}


def active_package() -> str:
    import os
    if os.environ.get("SYLLABUS_PACKAGE"):
        return os.environ["SYLLABUS_PACKAGE"]
    cfg = CONTENT_ROOT / "active.yaml"
    m = re.search(r"""^active:[ \t]*["']?([A-Za-z0-9_.-]+)""", cfg.read_text(encoding="utf-8"), re.M) if cfg.exists() else None
    if not m:
        raise SystemExit("courses/active.yaml: не указано active: <папка обучения>")
    return m.group(1)


def all_packages() -> list[str]:
    return sorted(p.parent.name for p in CONTENT_ROOT.glob("*/package.yaml"))


# Package ids become the first segment of every address (/<package>/learn/…), so they must not clash with the platform's own paths.
RESERVED_IDS = {"learn", "test", "record", "trainer", "reference", "api", "assets", "pyodide", "src", "node_modules"}
PACKAGE_ID = re.compile(r"[a-z0-9][a-z0-9_.-]*")
COLORS = {"green", "lav", "amber"}


def passport_errors(pkg: str, meta: dict) -> list[str]:
    """Optional catalog fields of package.yaml: types and allowed values (docs/template/course-package.md)."""
    where = f"courses/{pkg}/package.yaml"
    errs = []
    if not PACKAGE_ID.fullmatch(pkg) or pkg in RESERVED_IDS:
        errs.append(f"{where}: имя папки '{pkg}' — только строчная латиница, цифры, '-', '_', '.', и не одно из {sorted(RESERVED_IDS)}")
    if "icon" in meta and not (isinstance(meta["icon"], str) and re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", meta["icon"])):
        errs.append(f"{where}: icon — имя иконки lucide через дефис, например brain-circuit")
    if "color" in meta and meta["color"] not in COLORS:
        errs.append(f"{where}: color — одно из {sorted(COLORS)}")
    for key in ("subtitle", "level", "license", "summary"):
        if key in meta and not isinstance(meta[key], str):
            errs.append(f"{where}: {key} — строка")
    if "version" in meta and not isinstance(meta["version"], (str, int, float)):
        errs.append(f"{where}: version — строка, например 1.0.0")
    if "tags" in meta and not (isinstance(meta["tags"], list) and all(isinstance(x, str) for x in meta["tags"])):
        errs.append(f"{where}: tags — список строк")
    if "order" in meta and meta["order"] not in ("strict", "free"):
        errs.append(f"{where}: order — strict (по порядку, по умолчанию) или free (все темы открыты сразу)")
    pre = meta.get("prerequisites")
    if pre is not None and not (isinstance(pre, dict) and all(isinstance(pre.get(k, []), list) and all(isinstance(x, str) for x in pre.get(k, [])) for k in ("know", "not_needed"))):
        errs.append(f"{where}: prerequisites — {{know: [строки], not_needed: [строки]}}")
    if "author" in meta and not (isinstance(meta["author"], str) or (isinstance(meta["author"], dict) and isinstance(meta["author"].get("name"), str))):
        errs.append(f"{where}: author — строка или {{name: …, url: …}}")
    return errs


def use_package(pkg: str) -> list[str]:
    """Point every path at courses/<pkg>/ and read its passport. Returns passport errors."""
    global PKG, PKG_DIR, SRC, OUT, TREES, COURSES, GLOSSARY, META
    PKG, PKG_DIR = pkg, CONTENT_ROOT / pkg
    SRC, COURSES, GLOSSARY = PKG_DIR / "program.yaml", PKG_DIR / "lessons", PKG_DIR / "glossary.yaml"
    OUT, TREES = PKG_DIR / "docs" / "curriculum.md", PKG_DIR / "docs" / "prerequisite-trees.md"
    errors: list[str] = []
    meta_file = PKG_DIR / "package.yaml"
    if not meta_file.is_file():
        return [f"courses/{pkg}: нет package.yaml"]
    META = yaml.safe_load(meta_file.read_text(encoding="utf-8")) or {}
    if META.get("id") != pkg:
        errors.append(f"courses/{pkg}/package.yaml: id '{META.get('id')}' must equal the folder name '{pkg}'")
    if not META.get("title"):
        errors.append(f"courses/{pkg}/package.yaml: missing title")
    errors += passport_errors(pkg, META)
    if not SRC.is_file():
        errors.append(f"courses/{pkg}: нет program.yaml")
    return errors
ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]


def rel(p: Path) -> Path:
    """Path for messages: relative to the repo when possible (packages under test may live elsewhere)."""
    try:
        return p.relative_to(ROOT)
    except ValueError:
        return p


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
    every = (META.get("rules") or {}).get("every_course_has")
    if every:
        for course in data["courses"]:
            if str(course["id"]) not in [str(x) for x in every.get("except", [])] and not any(d["subject"] == every["subject"] for d in course["disciplines"]):
                errors.append(f"course {course['id']}: no level of {every['subject']} (package rule every_course_has)")

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


def example_discipline(data: dict) -> str:
    """«Программирование II»-style example: the first subject that has a second level, or a plain description."""
    multi = [d for c in data["courses"] for d in c["disciplines"] if d["level"] == 2]
    return f"например, «{disc_name(data, multi[0])}»" if multi else "уровень и предмет вместе"


def render_curriculum(data: dict) -> str:
    sections, disc_of, course_of, order = index(data)
    titles = {s["id"]: s["title"] for s in sections}
    discs = [d for c in data["courses"] for d in c["disciplines"]]
    total = sum(d["hours"] for d in discs)
    n_top = sum(len(s["topics"]) for s in sections)
    L = [
        "# Учебный план",
        "",
        f"> **Файл сгенерирован** из `courses/{PKG}/program.yaml` скриптом `tools/program/build.py` — правьте YAML, не этот файл.",
        "> " + ", ".join(f"{n} {plural(n, *w)}" for n, w in [
            (len(data['courses']), ("курс", "курса", "курсов")), (len(data['subjects']), ("предмет", "предмета", "предметов")),
            (len(discs), ("дисциплина", "дисциплины", "дисциплин")), (len(sections), ("раздел", "раздела", "разделов")),
            (n_top, ("тема", "темы", "тем"))]) + f"; около {total} ч учёбы + курсовые проекты (~30 ч каждый).",
        "",
        "## Как устроено",
        "",
        f"- **Предмет** — сквозная линия ({', '.join(s['title'] for s in data['subjects'][:3])}…). У предмета есть уровни: I, II, III…",
        f"- **Дисциплина** — один уровень предмета на конкретном курсе ({example_discipline(data)}). Уровень растёт, когда в предмете появляются новые темы; повторение уровень не повышает.",
        "- Внутри курса дисциплины идут строго друг за другом, без чередования.",
    ]
    gates = [l for l in data["program"].get("levels") or [] if l.get("gate")]
    if gates:
        L.append("- Рубежи: " + "; ".join(f"{l['title'].lower()} — {l['gate'][0].lower()}{l['gate'][1:]}" for l in gates) + ".")
    if data["program"].get("residual_check"):
        L.append(f"- Дополнительно: {data['program']['residual_check']}.")
    L += [f"- {x}" for x in data["program"].get("principles") or []]
    L += [
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
    if data.get("graduation"):
        L += ["---", "", f"## {data['graduation']['title']}", ""] + [f"- {p}" for p in data["graduation"].get("parts", [])]
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


def names(term: str, text: str) -> bool:
    """Whether the text names the term in any case form: every word by its stem («разметка данных» ~ «разметкой данных»)."""
    stems = [w[: max(4, len(w) - 3)] for w in re.findall(r"\w+", term.lower()) if len(w) > 2]
    return bool(stems) and all(re.search(r"(?<!\w)" + re.escape(s), text) for s in stems)


def defines(term: str, text: str) -> bool:
    """Whether a <Theorem title="…"> in the text names the term (any case form)."""
    return any(names(term, title.lower()) for title in re.findall(r'<Theorem[^>]*title="([^"]+)"', text, re.I))


def check_content(data: dict) -> tuple[list[str], set[str]]:
    """Authored topics must exist in the plan; glossary terms must exist; quiz answers must be valid."""
    errors: list[str] = []
    sections, *_ = index(data)
    topic_ids = {f"{s['id']}.{i}" for s in sections for i in range(1, len(s["topics"]) + 1)}
    section_ids = {s["id"] for s in sections}
    terms = {t["id"]: t for t in (yaml.safe_load(GLOSSARY.read_text(encoding="utf-8")) or [])} if GLOSSARY.exists() else {}
    glossary = set(terms)
    # Program order of topics: a concept may be used only in its own topic or after it (glossary introduced_in).
    order = {f"{s['id']}.{i}": n for n, (s, i) in enumerate((s, i) for s in sections for i in range(1, len(s["topics"]) + 1))}
    authored: set[str] = set()
    linked: dict[str, set[str]] = {}
    texts: dict[str, str] = {}
    for mdx in sorted(COURSES.glob("*/*/*/topic.mdx")):
        disc, sec, folder = mdx.relative_to(COURSES).parts[:3]
        tid = f"{disc}.{sec}.{int(folder.split('-')[0])}"
        if tid not in topic_ids:
            errors.append(f"{rel(mdx)}: topic {tid} is not in program.yaml")
        authored.add(tid)
        text = mdx.read_text(encoding="utf-8")
        # MDX attributes in plain quotes do not support \" escapes — the page fails to compile
        for n, line in enumerate(text.splitlines(), 1):
            if re.match(r'\s*[A-Za-z]+="[^"]*\\"', line):
                errors.append(f'{rel(mdx)}:{n}: escaped quote inside attr="…" breaks MDX — use attr={{"…"}} or «»')
        used = set(re.findall(r'<Term id="([^"]+)"', text))
        linked[tid] = set(used)
        texts[tid] = text.lower()
        # concepts the topic relies on without linking them: export const meta = { uses: ["weight", "layer"] }
        m = re.search(r"uses:\s*\[([^\]]*)\]", text)
        used |= set(re.findall(r'"([^"]+)"', m.group(1))) if m else set()
        for term_id in sorted(used):
            if term_id not in glossary:
                errors.append(f"{rel(mdx)}: term '{term_id}' missing in glossary.yaml")
                continue
            intro = terms[term_id].get("introduced_in")
            if intro and intro in order and tid in order and order[intro] > order[tid]:
                errors.append(f"{rel(mdx)}: '{term_id}' is used before it is introduced (glossary: introduced_in {intro}) — explain it here or earlier")
    for term_id, t in terms.items():
        intro = t.get("introduced_in")
        if intro and intro not in order:
            errors.append(f"glossary.yaml: '{term_id}': introduced_in {intro} is not a topic of program.yaml")
        if (META.get("rules") or {}).get("glossary_en") and not str(t.get("en") or "").strip():
            errors.append(f"glossary.yaml: '{term_id}': no English name (en) — package rule glossary_en")
        if intro in order and intro in authored and term_id not in linked.get(intro, set()) and not defines(str(t.get("term", "")), texts.get(intro, "")):
            # the topic that introduces a term must mark it (<Term id>) or define it (<Theorem title>), not just print it in bold:
            # the learner needs the hover hint, and the term comes back in later topics
            errors.append(f"glossary.yaml: '{term_id}': introduced_in {intro}, but that topic does not mark it with <Term id=\"{term_id}\"> or define it in a <Theorem>")
    for qf in sorted(list(COURSES.glob("*/*/*/quiz.yaml")) + list(COURSES.glob("*/*/test.yaml"))):
        try:
            quiz = yaml.safe_load(qf.read_text(encoding="utf-8")) or {}
        except yaml.YAMLError as e:
            errors.append(f"{rel(qf)}: invalid YAML: {e}")
            continue
        if qf.name == "test.yaml":
            disc, sec = qf.relative_to(COURSES).parts[:2]
            if f"{disc}.{sec}" not in section_ids:
                errors.append(f"{rel(qf)}: section {disc}.{sec} is not in program.yaml")
        ids = set()
        for q in quiz.get("questions", []):
            where = f"{rel(qf)}:{q.get('id')}"
            if q["id"] in ids:
                errors.append(f"{where}: duplicate question id")
            ids.add(q["id"])
            # an unquoted "text: more text" in YAML becomes a {key: value} pair, not text — the page then fails
            for key in ("q", "explain"):
                if key in q and not isinstance(q[key], str):
                    errors.append(f"{where}: {key} must be text (quote it if it contains ': ')")
            for i, o in enumerate(q.get("options") or []):
                if not isinstance(o, str):
                    errors.append(f"{where}: option {i} must be text, got {type(o).__name__} (quote it if it contains ': ')")
            if q["type"] in ("single", "multi"):
                n = len(q.get("options", []))
                ans = q.get("answer")
                ans = ans if isinstance(ans, list) else [ans]
                if q["type"] == "single" and len(ans) != 1:
                    errors.append(f"{where}: single-choice needs one answer")
                if not ans or any(not isinstance(a, int) or not 0 <= a < n for a in ans):
                    errors.append(f"{where}: answer index out of range")
                for t in q.get("traps", []) or []:
                    if not isinstance(t, int) or not 0 <= t < n or t in ans:
                        errors.append(f"{where}: trap {t} must be a wrong option index")
            elif q["type"] == "fields":
                fs = q.get("fields") or []
                if not fs or any(not isinstance(f, dict) or not isinstance(f.get("label"), str) or f.get("answer") in (None, "", []) for f in fs):
                    errors.append(f"{where}: fields question needs fields: [{{label: текст, answer: ответ или [варианты]}}]")
            elif q["type"] == "code":
                # a code question is graded by its tests: the reference solution passes them all, the starter does not
                tests = q.get("tests") or {}
                if not (tests.get("io") or tests.get("asserts")) or not isinstance(q.get("solution"), str):
                    errors.append(f"{where}: code question needs tests (io or asserts) and a solution")
                else:
                    res = run_task(q["solution"], tests)
                    if isinstance(res, str) or not res or not all(r["ok"] for r in res):
                        bad = res if isinstance(res, str) else [r["name"] for r in res if not r["ok"]]
                        errors.append(f"{where}: reference solution fails its tests: {bad}")
                    if q.get("starter"):
                        res = run_task(q["starter"], tests)
                        if not isinstance(res, str) and res and all(r["ok"] for r in res):
                            errors.append(f"{where}: the starter code already passes all tests")
            elif q["type"] not in ("open",):
                errors.append(f"{where}: unknown question type {q['type']!r} (single, multi, open, fields, code)")
            elif q["type"] == "open" and not q.get("rubric"):
                errors.append(f"{where}: open question needs a rubric for the teacher")
    errors += check_tasks()
    return errors, authored


def run_task(code: str, tests: dict) -> list[dict] | str:
    """Results of the shared sandbox driver for this code, or an error string."""
    try:
        p = subprocess.run([sys.executable, str(Path(__file__).with_name("taskcheck.py"))], input=json.dumps({"code": code, "tests": tests}, ensure_ascii=False).encode("utf-8"),
                           capture_output=True, timeout=30)
    except subprocess.TimeoutExpired:
        return "timed out (endless loop?)"
    if p.returncode:
        return p.stderr.decode("utf-8", "replace")[-500:]
    return json.loads(p.stdout.decode("utf-8"))["results"]


def check_tasks() -> list[str]:
    """Coding tasks: required fields, unique ids, every <Sandbox task> exists, the reference solution
    passes all tests and the starter code does not."""
    errors: list[str] = []
    ids: dict[str, Path] = {}
    for tf in sorted(COURSES.glob("**/tasks/*/task.yaml")):
        where = rel(tf)
        try:
            t = yaml.safe_load(tf.read_text(encoding="utf-8")) or {}
        except yaml.YAMLError as e:
            errors.append(f"{where}: invalid YAML: {e}")
            continue
        missing = [k for k in ("id", "title", "sandbox", "statement", "solution", "tests") if not t.get(k)]
        if missing:
            errors.append(f"{where}: missing {', '.join(missing)}")
            continue
        if t["id"] in ids:
            errors.append(f"{where}: duplicate task id {t['id']} (also {rel(ids[t['id']])})")
        ids[t["id"]] = tf
        if t["sandbox"] != "python-browser":
            continue
        tests = t["tests"]
        if not (tests.get("io") or tests.get("asserts")):
            errors.append(f"{where}: no tests")
            continue
        res = run_task(t["solution"], tests)
        if isinstance(res, str):
            errors.append(f"{where}: reference solution crashed: {res}")
        else:
            for r in res:
                if not r["ok"]:
                    errors.append(f"{where}: reference solution fails test '{r['name']}': {r.get('error') or r.get('message') or ('got ' + repr(r.get('got')))}")
        if t.get("starter"):
            res = run_task(t["starter"], tests)
            if isinstance(res, list) and res and all(r["ok"] for r in res):
                errors.append(f"{where}: starter code already passes all tests")
    for mdx in COURSES.glob("**/topic.mdx"):
        for tid in re.findall(r'<Sandbox task="([^"]+)"', mdx.read_text(encoding="utf-8")):
            if tid not in ids:
                errors.append(f"{rel(mdx)}: task '{tid}' not found")
    return errors


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
        f"<!-- progress:{PKG}:start -->",
        f"**Готовность учебных материалов: {pct:.1f} %** — написано тем: {len(authored)} из {total}.",
        "",
        "| Курс | Темы |",
        "|---|---|",
        *per_course,
        f"<!-- progress:{PKG}:end -->",
    ])


def check_package(pkg: str, check: bool, readme: bool) -> int:
    errors = use_package(pkg)
    if errors:
        print(f"{pkg}: FAILED", file=sys.stderr)
        for e in errors:
            print("  -", e, file=sys.stderr)
        return 1
    data = load()
    errors = validate(data)
    content_errors, authored = check_content(data)
    errors += content_errors
    if errors:
        print(f"{pkg}: FAILED", file=sys.stderr)
        for e in errors:
            print("  -", e, file=sys.stderr)
        return 1
    outputs = {OUT: render_curriculum(data), TREES: render_trees(data)}
    if readme:
        text = README.read_text(encoding="utf-8")
        start, end = f"<!-- progress:{pkg}:start -->", f"<!-- progress:{pkg}:end -->"
        if start in text and end in text:
            head, rest = text.split(start, 1)
            tail = rest.split(end, 1)[1]
            outputs[README] = head + render_progress(data, authored) + tail
    if check:
        stale = [str(rel(p)) for p, text in outputs.items() if not p.exists() or p.read_text(encoding="utf-8") != text]
        if stale:
            print(f"{pkg}: stale generated files: " + ", ".join(stale) + " — run without --check", file=sys.stderr)
            return 1
    else:
        for p, text in outputs.items():
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text, encoding="utf-8", newline="\n")
    print(f"{pkg}: OK")
    return 0


def main() -> int:
    args = sys.argv[1:]
    active = active_package()
    if "--all" in args:
        pkgs = all_packages()
    elif "--package" in args:
        pkgs = [args[args.index("--package") + 1]]
    else:
        pkgs = [active]
    if not pkgs:
        print("courses/: no learning packages (folders with package.yaml)", file=sys.stderr)
        return 1
    return max(safe_check(p, "--check" in args, readme=True) for p in pkgs)


def safe_check(pkg: str, check: bool, readme: bool) -> int:
    """One broken package (bad YAML, missing keys) is reported as FAILED, not as a traceback."""
    try:
        return check_package(pkg, check, readme)
    except (yaml.YAMLError, KeyError, TypeError, ValueError, OSError) as e:
        print(f"{pkg}: FAILED", file=sys.stderr)
        print(f"  - {type(e).__name__}: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

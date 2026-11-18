"""Token costs of building a course — for developers only, never shown in the app.

Reads Claude Code session transcripts (~/.claude/projects/<dir>/<session>.jsonl and the
subagent transcripts next to them), adds up the tokens of every model response and splits them by
course-building stage:

* a subagent belongs to the stage named at the start of its description — `theory-review: prog1.control`
  (see STAGES); older descriptions without a prefix are classified by keywords;
* the main conversation is split into segments between the user's messages; a segment's tokens go
  to the stages of the files it changed (lessons, tests, tasks, platform code…), a segment that
  changed nothing is discussion with the user.

Then it estimates the cost of the rest of the program from the cost per finished topic.

    uv run --with pyyaml tools/costs/costs.py           # prints the report
    uv run --with pyyaml tools/costs/costs.py --save    # writes courses/<id>/dev/token-costs.{md,json}
    uv run --with pyyaml tools/costs/costs.py --transcripts <dir>  # explicit transcript folder(s)
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import re
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[2]

# Stage id → title. Subagent descriptions start with the id: "facts: prog1.functions definitions".
STAGES = {
    "design": "Проектирование: источники, план, деревья предпосылок",
    "theory": "Теория: написание",
    "theory-review": "Теория: проверка (методист, ученик, редактор)",
    "facts": "Определения, факты и цитаты: фактчек",
    "tests": "Тесты: написание и экзаменатор",
    "tasks": "Задачи песочницы: написание и проверка",
    "platform": "Платформа и документация",
    "teaching-audit": "Аудит преподавания (проверка работы преподавателя)",
    "discussion": "Обсуждение с пользователем",
    "other": "Прочее",
}
CONTENT = ["design", "theory", "theory-review", "facts", "tests", "tasks"]

# Keyword rules for descriptions without a stage prefix (first match wins).
DESCRIPTION_RULES = [
    ("teaching-audit", r"teaching|grader|teacher feedback"),
    ("facts", r"fact|scientist|calque|idiom|quote|фактчек|цитат"),
    ("tests", r"examiner|quiz|экзаменатор"),
    ("tasks", r"task checker|\btasks?\b|задач"),
    ("platform", r"\bui\b|\bux\b|code review|platform|limits|package|mockup|sandbox|frontend|backend"),
    ("design", r"research|plan|prerequisite|scope|curriculum|hiring|job market|learning science|persona|source"),
    ("theory", r"^write|author|напис"),
    ("theory-review", r"review|edit|clarity|methodist|methodolog|student|редактор|методист"),
]

# Files a main-conversation segment changed → stage (first match wins).
PATH_RULES = [
    ("tasks", r"courses/[^\s\"']*/tasks/"),
    ("tests", r"courses/[^\s\"']*(quiz|test)\.yaml"),
    ("design", r"courses/[^\s\"']*(program\.yaml|package\.yaml|docs/)"),
    ("theory", r"courses/[^\s\"']*(topic\.mdx|glossary\.yaml|components/)"),
    ("platform", r"\b(apps|tools|scripts|docs)/|package\.json|CLAUDE\.md|README\.md"),
]

# Relative weights of token kinds (Anthropic price ratios; edit if they change). The weighted sum is
# "input-equivalent tokens": a fair single number to compare stages and to estimate.
WEIGHTS = {"input": 1.0, "cache_write_5m": 1.25, "cache_write_1h": 2.0, "cache_read": 0.1, "output": 5.0}


def norm(p: str) -> str:
    return p.replace("\\", "/").lower().rstrip("/")


def project_dirs(explicit: list[str]) -> list[Path]:
    if explicit:
        return [Path(p) for p in explicit]
    root = Path.home() / ".claude" / "projects"
    repo = norm(str(REPO))
    found = []
    for d in sorted(root.glob("*")) if root.exists() else []:
        for f in d.glob("*.jsonl"):
            with f.open(encoding="utf-8", errors="replace") as fh:
                if any(repo in norm(json.loads(line).get("cwd", "") or "") for line in fh if '"cwd"' in line):
                    found.append(d)
                    break
    return found


def usage_of(entry: dict) -> tuple[str, dict] | None:
    msg = entry.get("message") or {}
    u = msg.get("usage")
    if entry.get("type") != "assistant" or not u or not msg.get("id"):
        return None
    cc = u.get("cache_creation") or {}
    write_1h = cc.get("ephemeral_1h_input_tokens", 0) or 0
    write_5m = (u.get("cache_creation_input_tokens", 0) or 0) - write_1h
    return msg["id"], {
        "input": u.get("input_tokens", 0) or 0,
        "cache_write_5m": max(write_5m, 0),
        "cache_write_1h": write_1h,
        "cache_read": u.get("cache_read_input_tokens", 0) or 0,
        "output": u.get("output_tokens", 0) or 0,
        "model": msg.get("model", "?"),
    }


def read_usage(path: Path) -> dict[str, dict]:
    """message id → usage (a response is logged once per content block; keep one copy)."""
    out = {}
    with path.open(encoding="utf-8", errors="replace") as fh:
        for line in fh:
            try:
                r = usage_of(json.loads(line))
            except json.JSONDecodeError:
                continue
            if r:
                out[r[0]] = r[1]
    return out


def classify(text: str, rules) -> str | None:
    t = text.lower()
    for stage, rx in rules:
        if re.search(rx, t):
            return stage
    return None


def stage_of_description(desc: str) -> str:
    m = re.match(r"\s*([a-z-]+)\s*:", desc or "")
    if m and m.group(1) in STAGES:
        return m.group(1)
    return classify(desc or "", DESCRIPTION_RULES) or "other"


def is_user_prompt(e: dict) -> bool:
    if e.get("type") != "user" or e.get("isMeta") or e.get("isCompactSummary"):
        return False
    c = (e.get("message") or {}).get("content")
    if isinstance(c, str):
        return not c.startswith("<")  # command echoes, reminders
    return isinstance(c, list) and any(b.get("type") == "text" and not b.get("text", "").startswith("<") for b in c)


def touched(e: dict) -> list[str]:
    """Stages of the files an assistant message changes (edit/write targets, shell commands)."""
    votes = []
    for b in (e.get("message") or {}).get("content") or []:
        if not isinstance(b, dict) or b.get("type") != "tool_use":
            continue
        inp = b.get("input") or {}
        name = b.get("name", "")
        if name in ("Edit", "Write", "NotebookEdit", "MultiEdit"):
            text = inp.get("file_path", "")
        elif name in ("Bash", "PowerShell"):
            cmd = inp.get("command", "")
            if not re.search(r"git (commit|add|mv|rm)|python|sed -i|>\s*\S|Set-Content|Out-File", cmd):
                continue  # read-only commands do not decide what the work was about
            text = cmd
        else:
            continue
        for stage, rx in PATH_RULES:
            if re.search(rx, norm(text)):
                votes.append(stage)
                break
    return votes


def add(acc: dict, stage: str, u: dict, share: float = 1.0, sub: bool = False):
    a = acc[stage]
    a["sub" if sub else "main"] += weighted(u) * share
    for k in WEIGHTS:
        a[k] += u[k] * share
    a["models"][u["model"]] += weighted(u) * share


def weighted(u: dict) -> float:
    return sum(u[k] * w for k, w in WEIGHTS.items())


def new_acc():
    return collections.defaultdict(lambda: {**{k: 0.0 for k in WEIGHTS}, "models": collections.Counter(), "agents": 0, "main": 0.0, "sub": 0.0})


def collect(dirs: list[Path]):
    acc = new_acc()
    sessions = 0
    for d in dirs:
        for main in sorted(d.glob("*.jsonl")):
            sessions += 1
            usage = read_usage(main)
            seen = set()
            segment_ids: list[str] = []
            votes: list[str] = []

            def close():
                ids = [i for i in segment_ids if i in usage and i not in seen]
                seen.update(ids)
                counts = collections.Counter(votes)
                total = sum(counts.values())
                for i in ids:
                    if total:
                        for st, n in counts.items():
                            add(acc, st, usage[i], n / total)
                    else:
                        add(acc, "discussion", usage[i])

            with main.open(encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    try:
                        e = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if is_user_prompt(e):
                        close()
                        segment_ids, votes = [], []
                    elif e.get("type") == "assistant":
                        mid = (e.get("message") or {}).get("id")
                        if mid and mid not in segment_ids:
                            segment_ids.append(mid)
                        votes += touched(e)
            close()
            sub = main.with_suffix("") / "subagents"
            for f in sorted(sub.glob("*.jsonl")) if sub.exists() else []:
                meta = f.with_suffix(".meta.json")
                desc = json.loads(meta.read_text(encoding="utf-8")).get("description", "") if meta.exists() else ""
                st = stage_of_description(desc)
                acc[st]["agents"] += 1
                for u in read_usage(f).values():
                    add(acc, st, u, sub=True)
    return acc, sessions


def program_topics(package: str) -> tuple[int, int]:
    """(topics in the program, topics already written as lessons)."""
    pkg = REPO / "courses" / package
    prog = yaml.safe_load((pkg / "program.yaml").read_text(encoding="utf-8"))
    total = sum(len(s.get("topics") or []) for c in prog.get("courses") or [] for d in c.get("disciplines") or []
                for s in d.get("sections") or [])
    written = len(list((pkg / "lessons").glob("*/*/*/topic.mdx")))
    return total, written


def active_package() -> str:
    m = re.search(r"^active:\s*['\"]?([\w-]+)", (REPO / "courses" / "active.yaml").read_text(encoding="utf-8"), re.M)
    return m.group(1) if m else ""


def mtok(x: float) -> str:
    return f"{x / 1e6:,.1f}".replace(",", " ")


def report(acc, sessions: int, package: str) -> str:
    rows = [(st, acc[st]) for st in STAGES if st in acc]
    grand = sum(weighted(a) for _, a in rows) or 1
    lines = [
        f"# Расход токенов на создание курса `{package}`",
        "",
        f"Снимок от {dt.date.today().isoformat()}. Источник — журналы Claude Code ({sessions} сесс.), собран "
        "`tools/costs/costs.py`. Для разработчиков: в приложении не показывается.",
        "",
        "Взвешенные токены — входные, эквивалентные по цене: запись в кэш ×1,25 (5 мин) или ×2 (1 ч), чтение "
        "кэша ×0,1, выход ×5. Так этапы можно сравнивать одним числом. Все числа в миллионах.",
        "",
        "| Этап | Субагентов | Вход | Запись в кэш | Чтение кэша | Выход | Взвешенно | из них субагенты | Доля |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for st, a in rows:
        lines.append(f"| {STAGES[st]} | {a['agents'] or '—'} | {mtok(a['input'])} | {mtok(a['cache_write_5m'] + a['cache_write_1h'])} | "
                     f"{mtok(a['cache_read'])} | {mtok(a['output'])} | **{mtok(weighted(a))}** | {mtok(a['sub'])} | {weighted(a) / grand:.0%} |")
    lines.append(f"| **Всего** | {sum(a['agents'] for _, a in rows)} | | | | | **{mtok(grand)}** | {mtok(sum(a['sub'] for _, a in rows))} | 100% |")

    models = collections.Counter()
    for _, a in rows:
        models.update({m: v for m, v in a["models"].items() if not m.startswith("<")})
    lines += ["", "**По моделям (взвешенно):** " + ", ".join(f"{m} — {mtok(v)}" for m, v in models.most_common()), ""]

    total, written = program_topics(package)
    content = sum(weighted(acc[s]) for s in CONTENT if s in acc)
    if written:
        per = content / written
        lines += [
            "## Оценка на будущее",
            "",
            f"Готово тем: **{written}** из {total} в программе. Содержательные этапы (всё, кроме платформы и обсуждения) — "
            f"{mtok(content)} млн взвешенных токенов, то есть **≈ {mtok(per)} млн на тему** (с тестами, задачами и всеми кругами проверки).",
            "",
            "| Этап | На одну тему, млн |",
            "|---|---:|",
            *[f"| {STAGES[s]} | {mtok(weighted(acc[s]) / written)} |" for s in CONTENT if s in acc],
            "",
            f"Оставшиеся {total - written} тем по той же цене — **≈ {mtok(per * (total - written))} млн** взвешенных токенов. "
            "Это грубая оценка: темы с программированием дороже вводных (больше задач песочницы), а платформа "
            "и обсуждение сюда не входят — для нового курса на готовой платформе они заметно меньше.",
            "",
        ]
    lines += [
        "## Как вести учёт дальше",
        "",
        "Описание каждого субагента начинается с этапа: "
        + ", ".join(f"`{s}:`" for s in STAGES if s not in ("discussion", "other"))
        + " — например `theory-review: prog1.functions`. Тогда отчёт не угадывает этап по словам. "
        "Работа основного диалога делится по тому, какие файлы он менял.",
        "",
    ]
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--transcripts", nargs="*", default=[], help="Claude Code project folder(s) with session .jsonl files")
    ap.add_argument("--package", default=None, help="course package id (default: courses/active.yaml)")
    ap.add_argument("--save", action="store_true", help="write courses/<id>/dev/token-costs.md and .json (data for a future dashboard)")
    args = ap.parse_args()
    dirs = project_dirs(args.transcripts)
    if not dirs:
        sys.exit("Не нашёл журналов Claude Code для этого репозитория. Укажите папку: --transcripts <path>")
    acc, sessions = collect(dirs)
    package = args.package or active_package()
    text = report(acc, sessions, package)
    if args.save:
        out = REPO / "courses" / package / "dev"
        out.mkdir(exist_ok=True)
        (out / "token-costs.md").write_text(text, encoding="utf-8", newline="\n")
        total, written = program_topics(package)
        data = {
            "package": package, "date": dt.date.today().isoformat(), "sessions": sessions, "weights": WEIGHTS,
            "topics": {"program": total, "written": written},
            "stages": {st: {"title": STAGES[st], "agents": a["agents"], **{k: round(a[k]) for k in WEIGHTS},
                            "weighted": round(weighted(a)), "main": round(a["main"]), "subagents": round(a["sub"]), "models": {m: round(v) for m, v in a["models"].items()}}
                       for st, a in acc.items()},
        }
        (out / "token-costs.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")
        print("saved", out / "token-costs.md", "and token-costs.json")
    else:
        sys.stdout.reconfigure(encoding="utf-8")
        print(text)


if __name__ == "__main__":
    main()

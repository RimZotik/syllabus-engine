"""Print the teacher's (Claude's) checks of written answers as Markdown — input for the teaching audit.

The audit panel (docs/dev/teaching-audit.md) reads this: the question, its rubric, the learner's answer
and what the teacher said. Nothing here changes the database.

Usage: uv run --project apps/server python -m syllabus_server.teaching [--scope intro1.what.4] [--last 10]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import yaml

from . import settings
from .db import connect, migrate


ST = {"met": "выполнен", "partial": "частично", "missing": "не выполнен"}


def questions(package_dir: Path) -> dict[tuple[str, str], dict]:
    """(scope, question id) → question, for every topic quiz and section test of the package."""
    out = {}
    for f in (package_dir / "lessons").glob("*/*/*/quiz.yaml"):
        disc, sec, topic = f.parts[-4:-1]
        m = re.match(r"(\d+)", topic)
        scope = f"{disc}.{sec}.{int(m.group(1))}" if m else f"{disc}.{sec}.{topic}"
        out.update(_index(f, scope))
    for f in (package_dir / "lessons").glob("*/*/test.yaml"):
        disc, sec = f.parts[-3:-1]
        out.update(_index(f, f"{disc}.{sec}"))
    return out


def _index(f: Path, scope: str) -> dict:
    data = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
    items = data.get("questions", []) if isinstance(data, dict) else data
    return {(scope, q["id"]): q for q in items if isinstance(q, dict) and "id" in q}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scope", help="topic or section id, e.g. intro1.what.4")
    ap.add_argument("--last", type=int, default=10, help="how many most recent checks")
    ap.add_argument("--package", help="learning package id (default: courses/active.yaml)")
    args = ap.parse_args()
    settings.use_package(args.package)
    db = connect(); migrate(db)
    sql = "SELECT scope, item_id, answer, feedback, created_at FROM attempt WHERE kind = 'open' AND feedback IS NOT NULL"
    params: tuple = ()
    if args.scope:
        sql += " AND scope = ?"; params = (args.scope,)
    rows = db.execute(sql + " ORDER BY id DESC LIMIT ?", (*params, args.last)).fetchall()
    qs = questions(settings.package_dir())
    sys.stdout.reconfigure(encoding="utf-8")
    if not rows:
        print("Проверенных развёрнутых ответов нет.")
        return 0
    print(f"# Проверки развёрнутых ответов ({len(rows)})\n")
    for r in reversed(rows):
        q = qs.get((r["scope"], r["item_id"]), {})
        fb = json.loads(r["feedback"])
        print(f"## `{r['scope']}` · `{r['item_id']}` · {r['created_at']} · вердикт: {fb.get('verdict')}\n")
        print(f"**Вопрос.** {q.get('q', '(вопрос не найден в пакете)')}\n")
        if q.get("rubric"):
            print("**Рубрика:**\n" + "\n".join(f"- {c}" for c in q["rubric"]) + "\n")
        if q.get("wrong_answers"):
            print("**Типичные неверные ответы:**\n" + "\n".join(f"- {c}" for c in q["wrong_answers"]) + "\n")
        answer = json.loads(r["answer"]) if r["answer"] and r["answer"].startswith('"') else r["answer"]
        print("**Ответ ученика:**\n\n" + "\n".join("> " + line for line in str(answer).split("\n")) + "\n")
        for c in fb.get("criteria") or []:
            st = c.get("status") or ("met" if c.get("met") else "missing")  # older checks stored met: bool
            print(f"- {ST.get(st, st)}: {c.get('criterion')} — «{c.get('quote', '')}»")
        print(f"\n**Отзыв преподавателя:**\n\n{fb.get('feedback', '')}\n")
        if fb.get("misconception"):
            print(f"**Заблуждение по мнению преподавателя:** {fb['misconception']}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

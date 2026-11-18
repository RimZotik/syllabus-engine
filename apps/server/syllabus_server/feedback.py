"""Print open course feedback as Markdown — the inbox the course author (Claude) works through.

Usage: uv run --project apps/server python -m syllabus_server.feedback [--status open]
"""
from __future__ import annotations

import argparse
import sys

from .db import connect, migrate
from .settings import use_package

LABELS = {"content_issue": "Проблема в материале", "bug": "Ошибка платформы", "idea": "Идея", "question": "Вопрос по курсу"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--status", default="open")
    ap.add_argument("--package", help="learning package id (default: courses/active.yaml)")
    args = ap.parse_args()
    use_package(args.package)
    db = connect(); migrate(db)
    rows = db.execute("SELECT * FROM feedback WHERE status = ? ORDER BY topic_id, id", (args.status,)).fetchall()
    sys.stdout.reconfigure(encoding="utf-8")
    if not rows:
        print("Открытых замечаний нет.")
        return 0
    print(f"# Замечания к курсу ({len(rows)})\n")
    for r in rows:
        page = f" · страница {r['page'] + 1}" if r["page"] is not None else ""
        print(f"- **#{r['id']} · {LABELS[r['kind']]}** · {r['source']} · тема `{r['topic_id'] or '—'}`{page} · {r['created_at']}")
        if r["quote"]:
            for q in r["quote"].split("\n\n"):
                print(f"  > {q}")
        print(f"  {r['text']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
